/**
 * Multi-source news collector (CMP-131).
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
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CategoryKey, RawArticle, RawCluster } from './types';
import { toCategoryKey } from './types';
import { assertSourceAllowed } from './source-guard';

interface NewsSource {
  name: string;
  url: string;
  category: string;
}

function loadSources(): NewsSource[] {
  const configPath = join(process.cwd(), 'config', 'news_sources.json');
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as { news_sources: NewsSource[] };
  return parsed.news_sources;
}

// ─── RSS parser ────────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 'is');
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
}

function parseRssItems(xml: string, source: NewsSource): RawArticle[] {
  const items: RawArticle[] = [];
  const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || extractTag(block, 'guid');
    const description = extractTag(block, 'description') || extractTag(block, 'summary');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published');
    if (!title || !link) continue;

    const content = description
      ? description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    items.push({
      title: title.replace(/<[^>]+>/g, '').trim(),
      content: content.slice(0, 2000),
      url: link.trim(),
      source: source.name,
      category: toCategoryKey(source.category),
      publishedAt: pubDate ?? undefined,
    });

    if (items.length >= 15) break;
  }
  return items;
}

async function fetchFeed(source: NewsSource): Promise<RawArticle[]> {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return parseRssItems(await res.text(), source);
  } catch {
    console.warn(`[collector] failed to fetch ${source.name}`);
    return [];
  }
}

// ─── Special AI sources ───────────────────────────────────────────────────────

async function fetchHackerNews(): Promise<RawArticle[]> {
  try {
    const since = Math.floor(Date.now() / 1000) - 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=AI+LLM+machine+learning&tags=story&numericFilters=created_at_i>${since},points>50&hitsPerPage=15`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits: Array<{ title: string; url?: string; objectID: string; points: number; author: string }> };
    return (data.hits ?? [])
      .filter((h) => h.title && (h.url || h.objectID))
      .slice(0, 10)
      .map((h) => ({
        title: h.title,
        content: `HackerNews points: ${h.points} | by ${h.author}`,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: 'HackerNews',
        category: 'AI' as CategoryKey,
      }));
  } catch {
    console.warn('[collector] HackerNews fetch failed');
    return [];
  }
}

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

async function fetchArxiv(): Promise<RawArticle[]> {
  assertSourceAllowed('arxiv');
  try {
    const cats = 'cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG';
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(cats)}&sortBy=submittedDate&sortOrder=descending&max_results=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const articles: RawArticle[] = [];
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
      const block = match[1];
      const title = extractTag(block, 'title')?.replace(/\s+/g, ' ').trim() ?? '';
      const summary = extractTag(block, 'summary')?.replace(/\s+/g, ' ').trim() ?? '';
      const idTag = extractTag(block, 'id') ?? '';
      const link = idTag.includes('arxiv.org') ? idTag : '';
      const publishedStr = extractTag(block, 'published') ?? '';
      if (!title || !link) continue;
      if (publishedStr && new Date(publishedStr).getTime() < cutoff) continue;
      articles.push({ title, content: summary.slice(0, 800), url: link, source: 'ArXiv', category: 'AI' as CategoryKey, publishedAt: publishedStr || undefined });
      if (articles.length >= 10) break;
    }
    return articles;
  } catch {
    console.warn('[collector] ArXiv fetch failed');
    return [];
  }
}

async function fetchPwC(): Promise<RawArticle[]> {
  assertSourceAllowed('pwc');
  try {
    const url = 'https://paperswithcode.com/api/v1/papers/?ordering=-github_stars&page_size=15';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results: Array<{
        title: string;
        url_abs: string;
        abstract: string;
        published: string;
        repository_count: number;
      }>;
    };
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days for trending
    return (data.results ?? [])
      .filter((p) => p.title && p.url_abs)
      .filter((p) => !p.published || new Date(p.published).getTime() >= cutoff)
      .slice(0, 10)
      .map((p) => ({
        title: p.title,
        content: (p.abstract ?? '').slice(0, 800) || `Papers with Code | repos: ${p.repository_count}`,
        url: p.url_abs,
        source: 'Papers with Code',
        category: 'AI' as CategoryKey,
        publishedAt: p.published || undefined,
      }));
  } catch {
    console.warn('[collector] PwC fetch failed');
    return [];
  }
}

const NEWSLETTER_SOURCES: NewsSource[] = [
  { name: 'The Batch (DeepLearning.AI)', url: 'https://www.deeplearning.ai/the-batch/feed/', category: 'AI' },
  { name: 'Import AI',                   url: 'https://importai.substack.com/feed',          category: 'AI' },
  { name: 'TLDR AI',                     url: 'https://tldr.tech/ai/rss',                    category: 'AI' },
  { name: 'Last Week in AI',             url: 'https://lastweekin.ai/feed',                  category: 'AI' },
];

async function fetchNewsletterRSS(): Promise<RawArticle[]> {
  assertSourceAllowed('newsletter');
  const results = await Promise.allSettled(
    NEWSLETTER_SOURCES.map(async (src) => {
      const articles = await fetchFeed(src);
      return articles.map((a) => ({ ...a, source: src.name }));
    })
  );
  const all: RawArticle[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  return all.slice(0, 12);
}

async function fetchGithubTrending(): Promise<RawArticle[]> {
  const articles: RawArticle[] = [];
  for (const lang of ['python', 'typescript']) {
    try {
      const res = await fetch(`https://github.com/trending/${lang}?since=daily`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)', Accept: 'text/html' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      let count = 0;
      for (const block of html.matchAll(/<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)) {
        if (count >= 5) break;
        const content = block[1];
        const repoPath = content.match(/href="\/([^"\/]+\/[^"\/]+)"/)?.[1] ?? '';
        if (!repoPath) continue;
        const description = content.match(/<p[^>]*>\s*([\s\S]*?)\s*<\/p>/)?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? '';
        const starsDelta = parseInt((content.match(/([\d,]+)\s*stars today/i)?.[1] ?? '0').replace(/,/g, ''), 10);
        const fullText = `${repoPath} ${description}`.toLowerCase();
        const aiKeywords = ['ai', 'llm', 'ml', 'machine learning', 'agent', 'gpt', 'transformer', 'neural', 'model', 'diffusion', 'embedding', 'rag', 'inference'];
        if (!aiKeywords.some((kw) => fullText.includes(kw))) continue;
        articles.push({
          title: `[GitHub Trending] ${repoPath} — ${description || 'AI/ML 오픈소스'}`,
          content: `${description} | Language: ${lang} | Stars today: +${starsDelta}`,
          url: `https://github.com/${repoPath}`,
          source: 'GitHub Trending',
          category: 'AI' as CategoryKey,
          isGithubTrending: true,
          githubStarsDelta: starsDelta,
          githubLanguage: lang.charAt(0).toUpperCase() + lang.slice(1),
        });
        count++;
      }
    } catch {
      console.warn(`[collector] GitHub Trending (${lang}) fetch failed`);
    }
  }
  return articles;
}

const AI_BLOG_SOURCES: NewsSource[] = [
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
  // URL dedup first
  const urlSeen = new Set<string>();
  const urlDeduped = articles.filter((a) => {
    if (urlSeen.has(a.url)) return false;
    urlSeen.add(a.url);
    return true;
  });

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

  const rssResults = await Promise.allSettled(sources.map(fetchFeed));

  // Group articles by category, then interleave across sources (round-robin) so no
  // single prolific feed monopolises the first N cluster slots.
  const bySourceAndCat = new Map<CategoryKey, RawArticle[][]>();
  rssResults.forEach((result, i) => {
    if (result.status !== 'fulfilled' || result.value.length === 0) return;
    const cat = toCategoryKey(sources[i].category);
    if (!bySourceAndCat.has(cat)) bySourceAndCat.set(cat, []);
    bySourceAndCat.get(cat)!.push(result.value);
  });
  const rawByCategory = new Map<CategoryKey, RawArticle[]>();
  for (const [cat, sourceLists] of bySourceAndCat.entries()) {
    const interleaved: RawArticle[] = [];
    const maxLen = Math.max(...sourceLists.map((s) => s.length));
    for (let i = 0; i < maxLen; i++)
      for (const list of sourceLists)
        if (i < list.length) interleaved.push(list[i]);
    rawByCategory.set(cat, interleaved);
  }

  // AI category: extra sources
  const extraResults = await Promise.allSettled([
    fetchHackerNews(),
    fetchRedditSubreddit('MachineLearning'),
    fetchRedditSubreddit('LocalLLaMA'),
    fetchArxiv(),
    fetchPwC(),
    fetchNewsletterRSS(),
    fetchGithubTrending(),
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
