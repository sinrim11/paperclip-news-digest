/**
 * Multi-source news collector (CMP-131 / CMP-142).
 *
 * Per-category source strategy:
 *   글로벌  — overseas RSS (BBC / Guardian / Reuters / AP / Al Jazeera)
 *   증권    — overseas RSS (Bloomberg / Reuters / CNBC / FT / MarketWatch)
 *   AI      — overseas RSS + HackerNews + Reddit r/ML + r/LocalLLaMA
 *              + ArXiv cs.AI/cs.CL/cs.LG + GitHub Trending + AI company blogs
 *   정치    — Korean RSS (연합 / KBS / 조선 / 한겨레 / 경향 / MBC)
 *   부동산  — Korean RSS (매경 / 한경 / 연합 / 이데일리 / 뉴스핌)
 *
 * Clustering: 3-signal composite similarity
 *   titleJaccard × 0.40 + entityOverlap × 0.35 + bigramSim × 0.25 ≥ 0.55
 *
 * Collector modules (Phase 1-A):
 *   src/lib/collectors/{rss,github,arxiv,hn,pwc,newsletter}.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CategoryKey, RawArticle, RawCluster } from './types';
import { collectRss, fetchFeed, type RssSource } from './collectors/rss';
import { collectHN } from './collectors/hn';
import { collectArxiv } from './collectors/arxiv';
import { collectPwC } from './collectors/pwc';
import { collectNewsletter } from './collectors/newsletter';
import { collectGithub } from './collectors/github';
import { dedupArticles } from './dedup';

function loadSources(): RssSource[] {
  const configPath = join(process.cwd(), 'config', 'news_sources.json');
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as { news_sources: RssSource[] };
  return parsed.news_sources;
}

// ─── Reddit (not a formal collector type — kept inline) ───────────────────────

async function fetchRedditSubreddit(subreddit: string): Promise<RawArticle[]> {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=10`, {
      headers: { 'User-Agent': 'NewsDigestBot/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data: { children: Array<{ data: { title: string; url: string; selftext: string; score: number; permalink: string } }> };
    };
    return (data.data?.children ?? [])
      .filter((c) => c.data?.title)
      .slice(0, 8)
      .map((c) => ({
        title: c.data.title,
        content: (c.data.selftext ?? '').slice(0, 500) || `Reddit score: ${c.data.score}`,
        url: c.data.url ?? `https://reddit.com${c.data.permalink}`,
        source: `Reddit r/${subreddit}`,
        category: 'AI' as CategoryKey,
      }));
  } catch {
    console.warn(`[collector] Reddit r/${subreddit} fetch failed`);
    return [];
  }
}

const AI_BLOG_SOURCES: RssSource[] = [
  { name: 'OpenAI Blog',     url: 'https://openai.com/blog/rss/',           category: 'AI' },
  { name: 'Anthropic News',  url: 'https://www.anthropic.com/news/rss.xml', category: 'AI' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml',   category: 'AI' },
  { name: 'Meta AI Blog',    url: 'https://ai.meta.com/blog/feed/',         category: 'AI' },
  { name: 'Mistral AI',      url: 'https://mistral.ai/news/rss',            category: 'AI' },
];

// ─── 3-signal similarity ──────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[\s\-_,.()\[\]\/]+/).filter((t) => t.length > 1));
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// High-frequency abbreviations that appear in almost every article — they carry
// no discriminating signal across stories and inflate cross-topic similarity.
const ENTITY_STOP_ABBRS = new Set(['AI', 'US', 'UK', 'EU', 'UN', 'WHO', 'NATO', 'IMF', 'GDP', 'CEO', 'IT', 'IPO', 'PE', 'VC']);

/** Extract named entities: English proper nouns, abbreviations, numbers+units, Korean proper nouns */
function extractEntities(text: string): Set<string> {
  const entities = new Set<string>();
  // English abbreviations (2-6 caps), skip common stop-abbreviations
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) {
    if (!ENTITY_STOP_ABBRS.has(m[0])) entities.add(m[0]);
  }
  // English proper nouns: require 4+ total chars to exclude "The", "Set", "New", etc.
  for (const m of text.matchAll(/\b[A-Z][a-z]{3,}\b/g)) entities.add(m[0].toLowerCase());
  // Numbers with units
  for (const m of text.matchAll(/\b\d+(?:[.,]\d+)?(?:%|bp|bps|B|M|K|T|x|억|조|만|달러|원|위안)?\b/g)) {
    if (m[0].length > 1) entities.add(m[0]);
  }
  // Korean proper nouns (2+ chars before josa)
  for (const m of text.matchAll(/([가-힣]{2,6})(?=은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|가)/g)) {
    entities.add(m[1]);
  }
  return entities;
}

/** Word bigrams of the first 300 chars of content */
function bigramSet(text: string): Set<string> {
  const words = text.slice(0, 300).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) bigrams.add(`${words[i]}|${words[i + 1]}`);
  return bigrams;
}

// English cross-source articles use very different vocabulary for the same event.
// Empirical composite for BBC/Guardian same-story pairs: ~0.18-0.38 (title-only).
// Korean same-story pairs typically score 0.30+ via shared proper nouns / Korean nouns.
const COMPOSITE_THRESHOLD = 0.15;

function compositeSim(a: RawArticle, b: RawArticle): number {
  const titleSim = jaccardSim(tokenize(a.title), tokenize(b.title));
  // Use title-only for entities: content has English sentence starters ("The",
  // "This") that inflate cross-article entity overlap with no signal value.
  const entitySim = jaccardSim(
    extractEntities(a.title),
    extractEntities(b.title),
  );
  const bigramSimVal = jaccardSim(bigramSet(a.content), bigramSet(b.content));
  return titleSim * 0.40 + entitySim * 0.35 + bigramSimVal * 0.25;
}

// ─── Merged content builder ───────────────────────────────────────────────────

export function buildMergedContent(articles: RawArticle[]): string {
  // Sort by content length descending (richest source first), cap at 5
  const sorted = [...articles]
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, 5);

  if (sorted.length === 1) return sorted[0].content;

  return sorted
    .map((a, i) => `[출처 ${i + 1}: ${a.source}]\n${a.content.slice(0, 800)}`)
    .join('\n\n---\n\n');
}

// ─── Core clustering ──────────────────────────────────────────────────────────

export function clusterArticles(articles: RawArticle[], limit: number): RawCluster[] {
  // Full dedup: URL normalisation + same-source title-similarity (Phase 1-B)
  const { dedupedArticles: urlDeduped, duplicateRate } = dedupArticles(articles);
  if (duplicateRate > 0) {
    console.info(`[dedup] ${(duplicateRate * 100).toFixed(1)}% duplicates removed (${articles.length - urlDeduped.length}/${articles.length})`);
  }

  const clusters: RawCluster[] = [];

  for (const article of urlDeduped) {
    // GitHub Trending items never merge
    if (article.isGithubTrending) {
      clusters.push({
        title: article.title,
        url: article.url,
        source: article.source,
        category: article.category,
        publishedAt: article.publishedAt,
        mergedContent: article.content,
        articles: [article],
        sourceCount: 1,
        sourceList: [article.source],
        isGithubTrending: true,
        githubStarsDelta: article.githubStarsDelta,
        githubLanguage: article.githubLanguage,
      });
      continue;
    }

    // Try to join an existing cluster
    let joined = false;
    for (const cluster of clusters) {
      if (cluster.isGithubTrending) continue;
      // Only cluster CROSS-source: same source articles stay as separate clusters.
      // This prevents single-source inflation and ensures sourceCount > 1 means
      // genuinely different news organisations covered the same story.
      if (cluster.articles.some((a) => a.source === article.source)) continue;
      // Compare against cluster representative
      const rep: RawArticle = {
        title: cluster.title,
        content: cluster.articles[0].content,
        url: cluster.url,
        source: cluster.source,
        category: cluster.category,
      };
      if (compositeSim(article, rep) >= COMPOSITE_THRESHOLD) {
        cluster.articles.push(article);
        cluster.sourceList = [...new Set(cluster.articles.map((a) => a.source))];
        cluster.sourceCount = cluster.sourceList.length;
        cluster.mergedContent = buildMergedContent(cluster.articles);
        joined = true;
        break;
      }
    }

    if (!joined) {
      clusters.push({
        title: article.title,
        url: article.url,
        source: article.source,
        category: article.category,
        publishedAt: article.publishedAt,
        mergedContent: article.content,
        articles: [article],
        sourceCount: 1,
        sourceList: [article.source],
      });
    }
  }

  // Sort: multi-source clusters first (higher value), then by insertion order
  clusters.sort((a, b) => {
    if (a.isGithubTrending || b.isGithubTrending) return 0;
    return b.sourceCount - a.sourceCount;
  });

  return clusters.slice(0, limit);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function collectByCategory(
  limit = 12,
): Promise<Map<CategoryKey, RawCluster[]>> {
  const sources = loadSources();

  // RSS: collect + interleave per category
  const rawByCategory = await collectRss(sources);

  // AI category: extra sources from modular collectors + Reddit + AI blogs
  const extraResults = await Promise.allSettled([
    collectHN(),
    fetchRedditSubreddit('MachineLearning'),
    fetchRedditSubreddit('LocalLLaMA'),
    collectArxiv(),
    collectPwC(),
    collectNewsletter(),
    collectGithub(),
    ...AI_BLOG_SOURCES.map(fetchFeed),
  ]);

  const aiExtra: RawArticle[] = [];
  for (const r of extraResults) {
    if (r.status === 'fulfilled') aiExtra.push(...r.value);
  }
  rawByCategory.set('AI', [...(rawByCategory.get('AI') ?? []), ...aiExtra]);

  // Cluster each category
  const clusteredByCategory = new Map<CategoryKey, RawCluster[]>();
  for (const [cat, articles] of rawByCategory.entries()) {
    const regular = articles.filter((a) => !a.isGithubTrending);
    const trending = articles.filter((a) => a.isGithubTrending);
    const regularClusters = clusterArticles(regular, limit);
    // GitHub Trending: cluster separately, cap at 8, append after regular
    const trendingClusters = clusterArticles(trending, 8);
    clusteredByCategory.set(cat, cat === 'AI' ? [...regularClusters, ...trendingClusters] : regularClusters);
  }

  return clusteredByCategory;
}
