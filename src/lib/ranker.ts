import fs from 'fs';
import path from 'path';

import sourceTrustRaw from '../../config/source-trust.json';
import rankerWeightsRaw from '../../config/ranker-weights.json';

// ─── Config types ─────────────────────────────────────────────────────────────

interface SourceTrustConfig {
  version: string;
  defaultTrust: number;
  sourceTrust: Record<string, number>;
}

interface RankerWeightsConfig {
  version: string;
  weights: { W1: number; W2: number; W3: number; W4: number; W5: number };
  seenPenaltyValue: number;
  freshness: {
    fullScoreHours: number;
    decayTargetHours: number;
    decayTargetScore: number;
  };
  signal: {
    maxStarsDelta: number;
    maxSourceCount: number;
    starsDeltaWeight: number;
    sourceCountWeight: number;
  };
}

const sourceTrustCfg = sourceTrustRaw as SourceTrustConfig;
const weightsCfg = rankerWeightsRaw as RankerWeightsConfig;

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface Persona {
  id: string;
  name: string;
  interests: string[];
}

export interface RankableArticle {
  id: string;
  title: string;
  contextTags: string[];
  publishedAt: string | Date;
  sourceType: string;
  githubStarsDelta?: number;
  isGithubTrending?: boolean;
  sourceCount?: number;
}

export interface ScoreBreakdown {
  trust: number;
  freshness: number;
  interestMatch: number;
  signal: number;
  seenPenalty: number;
  score: number;
}

export interface RankResult {
  articleId: string;
  rank: number;
  score: number;
  breakdown: ScoreBreakdown;
}

// ─── Pure scoring functions (exported for tests) ──────────────────────────────

export function computeTrustScore(sourceType: string, cfg = sourceTrustCfg): number {
  return cfg.sourceTrust[sourceType.toLowerCase()] ?? cfg.defaultTrust;
}

export function computeFreshnessScore(
  hoursElapsed: number,
  fullScoreHours: number,
  decayTargetHours: number,
  decayTargetScore: number,
): number {
  if (hoursElapsed <= fullScoreHours) return 1.0;
  // Exponential decay: score(decayTargetHours) = decayTargetScore
  const k = -Math.log(decayTargetScore) / (decayTargetHours - fullScoreHours);
  return Math.max(0.01, Math.exp(-k * (hoursElapsed - fullScoreHours)));
}

export function computeInterestMatchScore(article: RankableArticle, persona: Persona): number {
  if (persona.interests.length === 0) return 0;

  const tags = article.contextTags.map((t) => t.toLowerCase());
  const titleTokens = article.title.toLowerCase().split(/[\s,/\-_]+/);
  const articleTerms = new Set([...tags, ...titleTokens]);

  let matches = 0;
  for (const interest of persona.interests) {
    const q = interest.toLowerCase();
    if (
      articleTerms.has(q) ||
      tags.some((t) => t.includes(q) || q.includes(t))
    ) {
      matches++;
    }
  }

  return Math.min(1.0, matches / persona.interests.length);
}

export function computeSignalScore(
  article: RankableArticle,
  cfg = weightsCfg.signal,
): number {
  const starNorm =
    article.isGithubTrending && article.githubStarsDelta
      ? Math.min(article.githubStarsDelta, cfg.maxStarsDelta) / cfg.maxStarsDelta
      : 0;

  const sourceNorm = Math.min(article.sourceCount ?? 1, cfg.maxSourceCount) / cfg.maxSourceCount;

  return Math.min(1.0, starNorm * cfg.starsDeltaWeight + sourceNorm * cfg.sourceCountWeight);
}

// ─── Full article scorer ──────────────────────────────────────────────────────

export function scoreArticle(
  article: RankableArticle,
  persona: Persona,
  seenArticleIds: Set<string>,
): ScoreBreakdown {
  const { W1, W2, W3, W4, W5 } = weightsCfg.weights;
  const { seenPenaltyValue, freshness: fCfg } = weightsCfg;

  const hoursElapsed = (Date.now() - new Date(article.publishedAt).getTime()) / 3_600_000;

  const trust = computeTrustScore(article.sourceType);
  const freshness = computeFreshnessScore(
    hoursElapsed,
    fCfg.fullScoreHours,
    fCfg.decayTargetHours,
    fCfg.decayTargetScore,
  );
  const interestMatch = computeInterestMatchScore(article, persona);
  const signal = computeSignalScore(article);
  const seenPenalty = seenArticleIds.has(article.id) ? seenPenaltyValue : 0;

  const score = trust * W1 + freshness * W2 + interestMatch * W3 + signal * W4 - seenPenalty * W5;

  return { trust, freshness, interestMatch, signal, seenPenalty, score };
}

// ─── Ranker entry point ───────────────────────────────────────────────────────

export interface RankOptions {
  logPath?: string;
}

export function rankArticles(
  articles: RankableArticle[],
  persona: Persona,
  seenArticleIds: Set<string>,
  options: RankOptions = {},
): RankResult[] {
  const scored = articles.map((article) => ({
    articleId: article.id,
    breakdown: scoreArticle(article, persona, seenArticleIds),
  }));

  scored.sort((a, b) => b.breakdown.score - a.breakdown.score);

  const results: RankResult[] = scored.map((item, idx) => ({
    articleId: item.articleId,
    rank: idx + 1,
    score: round4(item.breakdown.score),
    breakdown: { ...item.breakdown, score: round4(item.breakdown.score) },
  }));

  if (options.logPath) {
    const log = {
      timestamp: new Date().toISOString(),
      personaId: persona.id,
      personaName: persona.name,
      articleCount: articles.length,
      weights: weightsCfg.weights,
      results,
    };
    const dir = path.dirname(options.logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(options.logPath, JSON.stringify(log, null, 2), 'utf8');
  }

  return results;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
