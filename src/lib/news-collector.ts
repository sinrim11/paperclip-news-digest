/**
 * Multi-source news collector (CMP-131 / CMP-142).
 *
 * Per-category source strategy (2026-09-14 전수 점검 후 — 죽은 소스 교체분 반영):
 *   글로벌  — BBC / Guardian / Al Jazeera + 구글뉴스 경유 Reuters·AP
 *              (둘 다 공식 RSS가 폐지·차단돼 집계 피드가 유일한 무료 경로)
 *   증권    — Bloomberg / CNBC / MarketWatch / FT / WSJ + investing.com(TradingAgents 캐시)
 *   AI      — overseas RSS + HackerNews + Reddit r/ML + r/LocalLLaMA(.rss)
 *              + ArXiv + HF Daily Papers + GitHub Trending + AI 자사 발표(AI_BLOG_SOURCES)
 *   정치    — 연합 / 조선 / 한겨레 / 경향 / SBS
 *   부동산  — 매경 / 한경 / 아시아경제
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
import { collectInvesting } from './collectors/investing';
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

/**
 * 서브레딧들을 **멀티레딧 피드 한 번**으로 받는다(`/r/A+B/.rss`).
 *
 * 2026-09-14: `hot.json`은 403(비인증 JSON 차단)이라 `/.rss`(Atom)를 쓴다. 브라우저 UA로 바꾸면
 * 오히려 429다 — 봇 UA가 정직해서 통과하는 쪽이다.
 * 2026-10-08: 순차 호출(1.5초 간격)로도 둘째(r/LocalLLaMA)가 9/16부터 23일 연속 429였다 —
 * 비인증 .rss는 IP당 짧은 창에 1회만 허용하는 듯하다. 간격을 늘리는 대신 요청 자체를 1회로
 * 줄였다. 항목 링크(`/r/<sub>/comments/…`)에서 서브레딧을 되찾아 출처를 붙이고 서브레딧당
 * 상한을 둔다(멀티레딧은 hot 순이라 LocalLLaMA가 25건 중 22건을 차지했다).
 */
async function fetchRedditAll(subreddits: string[]): Promise<RawArticle[]> {
  const items = await fetchFeed({
    name: `Reddit r/${subreddits.join('+')}`,
    url: `https://www.reddit.com/r/${subreddits.join('+')}/.rss?limit=50`, // 50건 받아 서브레딧별 상한으로 자른다 — 25건이면 소수 서브레딧이 2건뿐
    category: 'AI',
  });
  const perSub = new Map<string, number>();
  const out: RawArticle[] = [];
  for (const a of items) {
    const sub = a.url.match(/reddit\.com\/r\/([^/]+)\//i)?.[1] ?? subreddits[0];
    const n = perSub.get(sub) ?? 0;
    if (n >= 8) continue;
    perSub.set(sub, n + 1);
    out.push({ ...a, source: `Reddit r/${sub}` });
  }
  return out;
}

/**
 * 두 목록을 고르게 섞는다. 뒤에 append하면 클러스터 상한(limit)에서 통째로 잘린다 —
 * investing 8건을 STOCKS 뒤에 붙였더니 상위 20개 안에 하나도 못 들어갔다.
 */
function interleaveInto(base: RawArticle[], extra: RawArticle[]): RawArticle[] {
  if (!extra.length) return base;
  if (!base.length) return extra;
  const out: RawArticle[] = [];
  const ratio = base.length / extra.length;
  let ei = 0;
  for (let i = 0; i < base.length; i++) {
    out.push(base[i]);
    while (ei < extra.length && i + 1 >= (ei + 1) * ratio) out.push(extra[ei++]);
  }
  while (ei < extra.length) out.push(extra[ei++]);
  return out;
}

/**
 * AI 1차 출처 — 자사 발표. 언론 RSS는 이걸 받아쓰므로 한 단계 늦고, 안 다루면 아예 놓친다.
 *
 * 2026-09-14 점검: 5개 중 **4개가 죽어 있었다**(OpenAI 403 · Anthropic 404 · Meta 404,
 * DeepMind·Mistral만 응답). 수집 실패가 Promise.allSettled에 삼켜져 조용히 0건이 되고 있었다.
 * 살아 있는 URL로 교체하고, 죽은 소스는 주석으로 사유를 남긴다.
 * 확인 방법: curl -sL -o /dev/null -w '%{http_code}' <url>
 */
const AI_BLOG_SOURCES: RssSource[] = [
  { name: 'OpenAI',          url: 'https://openai.com/news/rss.xml',          category: 'AI' }, // 구 /blog/rss/ 는 403
  { name: 'Google AI',       url: 'https://blog.google/technology/ai/rss',    category: 'AI' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml',     category: 'AI' },
  { name: 'Hugging Face',    url: 'https://huggingface.co/blog/feed.xml',     category: 'AI' },
  { name: 'Mistral AI',      url: 'https://mistral.ai/news/rss',              category: 'AI' },
  // Anthropic: RSS 미제공(2026-09-14 /rss.xml·/news/rss.xml·/news/feed.xml 모두 404)
  // Meta AI:   RSS 미제공(/blog/feed/·/blog/rss/ 404)
  // xAI:       blog/rss.xml 403 차단. 실제 발표는 X 게시물이라 무료 수집 경로가 없다
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
    fetchRedditAll(['MachineLearning', 'LocalLLaMA']),
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

  // 증권: investing.com 헤드라인(TradingAgents 캐시 경유 — collectors/investing.ts 주석 참조)
  const investing = await collectInvesting();
  if (investing.length) {
    rawByCategory.set('STOCKS', interleaveInto(rawByCategory.get('STOCKS') ?? [], investing));
  }

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
