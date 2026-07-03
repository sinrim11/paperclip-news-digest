// ─── Synthetic-Persona Divergence Gate (Phase 2-B) ───────────────────────────
// Tests whether persona-specific curation produces genuinely different rankings.
// Gate: Kendall τ-b ≤ 0.2 for ALL persona pairs → PASS (rankings diverge enough)
//       Any pair τ-b > 0.2  → FAIL (ranker needs tuning)
// Fully deterministic — no LLM required.

import fs from 'fs';
import path from 'path';
import type { RawArticle } from './types';

// ─── Persona definitions ─────────────────────────────────────────────────────

export interface PersonaConfig {
  id: string;
  name: string;
  /** Terms whose presence in title/content boosts article relevance */
  keywords: string[];
  /** Categories that carry extra weight for this persona */
  preferredCategories: string[];
}

export const PERSONAS: PersonaConfig[] = [
  {
    id: 'A',
    name: 'AI 개발자',
    keywords: [
      'llm', 'gpt', 'gpu', '오픈소스', 'open source', '모델', 'model', '학습', 'training',
      'transformer', 'inference', 'fine-tuning', '파인튜닝', 'huggingface', 'pytorch',
      '언어모델', '생성형', 'generative', 'diffusion', 'benchmark', '벤치마크',
      'nvidia', 'cuda', 'tpu', 'chip', '반도체', 'ai', 'ml', 'deep learning', '딥러닝',
    ],
    preferredCategories: ['AI'],
  },
  {
    id: 'B',
    name: '부동산 투자자',
    keywords: [
      '부동산', '아파트', '매매', '전세', '월세', '청약', '분양', '금리', '대출',
      '기준금리', '한국은행', '인하', '인상', '주택', '재건축', '재개발', '규제',
      '투기', '지역', '공급', '수요', '시세', '호가', '갭투자', 'dsr', 'ltv',
      '코스피', '코스닥', 'etf', '배당', '주가',
    ],
    preferredCategories: ['REALESTATE', 'STOCKS', 'POLICY'],
  },
  {
    id: 'C',
    name: '글로벌 정치 애널리스트',
    keywords: [
      '지정학', '외교', '무역', '제재', '전쟁', '분쟁', '협정', '정상회담', '외교부',
      '미중', '러시아', 'nato', '유엔', 'un', '안보리', '핵', '미사일', '북한',
      'g7', 'g20', '관세', 'tariff', '수출규제', '공급망', '인도태평양',
      '백악관', '국무부', '유럽연합', 'eu', '브렉시트',
    ],
    preferredCategories: ['GLOBAL', 'POLICY'],
  },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function scoreArticle(article: RawArticle, persona: PersonaConfig): number {
  const haystack = (article.title + ' ' + article.content.slice(0, 500)).toLowerCase();
  let score = 0;

  for (const kw of persona.keywords) {
    if (haystack.includes(kw.toLowerCase())) score += 1;
  }

  if (persona.preferredCategories.includes(article.category)) score += 2;

  return score;
}

/** Returns article indices sorted by descending relevance for the given persona */
export function rankArticles(articles: RawArticle[], persona: PersonaConfig): number[] {
  const scored = articles.map((a, idx) => ({ idx, score: scoreArticle(a, persona) }));
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx); // stable: tie-break by index
  return scored.map((s) => s.idx);
}

// ─── Kendall τ-b ─────────────────────────────────────────────────────────────

/**
 * Compute Kendall τ-b between two permutations of [0..n-1].
 * Both arrays must contain the same n elements in different orders.
 *
 * τ-b = (C - D) / sqrt((n*(n-1)/2 - T1) * (n*(n-1)/2 - T2))
 *
 * Because each ranking is a strict permutation (no ties within a single ranking),
 * T1 = T2 = 0, simplifying to τ-b = (C - D) / (n*(n-1)/2).
 */
export function kendallTauB(rankA: number[], rankB: number[]): number {
  const n = rankA.length;
  if (n !== rankB.length) throw new Error('Rankings must have equal length');
  if (n < 2) return 1;

  // Build position map for rankB: element → position
  const posB = new Map<number, number>();
  rankB.forEach((elem, pos) => posB.set(elem, pos));

  // Translate rankA into B-positions
  const bPositions = rankA.map((elem) => {
    const p = posB.get(elem);
    if (p === undefined) throw new Error(`Element ${elem} in rankA not found in rankB`);
    return p;
  });

  // Count concordant and discordant pairs
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = bPositions[i] - bPositions[j];
      if (diff < 0) concordant++;
      else if (diff > 0) discordant++;
      // diff === 0 is impossible in a strict permutation
    }
  }

  const denom = (n * (n - 1)) / 2;
  return (concordant - discordant) / denom;
}

// ─── Gate result types ────────────────────────────────────────────────────────

export interface PairResult {
  pair: string;
  tau_b: number;
  pass: boolean;
}

export interface DivergenceGateResult {
  date: string;
  article_count: number;
  pairs: PairResult[];
  overall_pass: boolean;
  threshold: number;
}

// ─── Gate runner ──────────────────────────────────────────────────────────────

export const DIVERGENCE_THRESHOLD = 0.2;

export function runDivergenceGate(articles: RawArticle[]): DivergenceGateResult {
  if (articles.length < 2) throw new Error('Need at least 2 articles to run divergence gate');

  const rankings = PERSONAS.map((p) => ({ persona: p, ranked: rankArticles(articles, p) }));

  const pairs: PairResult[] = [];
  for (let i = 0; i < rankings.length - 1; i++) {
    for (let j = i + 1; j < rankings.length; j++) {
      const tau_b = kendallTauB(rankings[i].ranked, rankings[j].ranked);
      pairs.push({
        pair: `${rankings[i].persona.id}-${rankings[j].persona.id}`,
        tau_b: parseFloat(tau_b.toFixed(4)),
        pass: tau_b <= DIVERGENCE_THRESHOLD,
      });
    }
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    article_count: articles.length,
    pairs,
    overall_pass: pairs.every((p) => p.pass),
    threshold: DIVERGENCE_THRESHOLD,
  };
}

// ─── JSON log persistence ─────────────────────────────────────────────────────

export function saveDivergenceGateLog(
  result: DivergenceGateResult,
  outputDir = path.join(process.cwd(), 'output'),
): string {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filename = `divergence-gate-${result.date}.json`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2), 'utf-8');
  return filepath;
}
