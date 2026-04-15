/**
 * Multi-source news collector (CMP-131).
 *
 * Strategies per category:
 *   글로벌  — overseas RSS only (BBC / Guardian / Reuters / AP / Al Jazeera)
 *   증권    — overseas RSS only (Bloomberg / Reuters / CNBC / FT / MarketWatch)
 *   AI      — overseas RSS + HackerNews API + Reddit r/ML + r/LocalLLaMA
 *              + ArXiv cs.AI/cs.CL/cs.LG + GitHub Trending (Python/TS AI repos)
 *              + major AI company blogs (OpenAI / Anthropic / DeepMind / Meta / Mistral)
 *   정치    — Korean RSS only  (연합 / KBS / 조선 / 한겨레 / 경향 / MBC)
 *   부동산  — Korean RSS only  (매경 / 한경 / 연합 / 이데일리 / 뉴스핌)
 *
 * Multi-source merge: Jaccard similarity ≥ 0.80 → same story, accumulate sourceCount + sourceList.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CategoryKey, RawArticle } from './types';
import { toCategoryKey } from './types';

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

// ─── RSS Parser ───────────────────────────────────────────────────────────────

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
    const xml = await res.text();
    return parseRssItems(xml, source);
  } catch {
    console.warn(`[collector] failed to fetch ${source.name}: ${source.url}`);
    return [];
  }
}

// ─── HackerNews ───────────────────────────────────────────────────────────────

async function fetchHackerNews(): Promise<RawArticle[]> {
  try {
    // Algolia HN search API — top AI stories from last 24h
    const url =
      'https://hn.algolia.com/api/v1/search?query=AI+LLM+machine+learning&tags=story&numericFilters=created_at_i>%d,points>50&hitsPerPage=15'.replace(
        '%d',
        String(Math.floor(Date.now() / 1000) - 86400),
      );
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

// ─── Reddit ───────────────────────────────────────────────────────────────────

async function fetchRedditSubreddit(subreddit: string): Promise<RawArticle[]> {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=10`;
    const res = await fetch(url, {
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

// ─── ArXiv ────────────────────────────────────────────────────────────────────

async function fetchArxiv(): Promise<RawArticle[]> {
  try {
    // ArXiv Atom feed for cs.AI + cs.CL + cs.LG, last 3 days, top 10
    const cats = 'cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG';
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(cats)}&sortBy=submittedDate&sortOrder=descending&max_results=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];

    const xml = await res.text();
    const entries = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi);
    const articles: RawArticle[] = [];

    for (const match of entries) {
      const block = match[1];
      const title = extractTag(block, 'title')?.replace(/\s+/g, ' ').trim() ?? '';
      const summary = extractTag(block, 'summary')?.replace(/\s+/g, ' ').trim() ?? '';
      const idTag = extractTag(block, 'id') ?? '';
      const link = idTag.includes('arxiv.org') ? idTag : '';
      if (!title || !link) continue;

      articles.push({
        title,
        content: summary.slice(0, 800),
        url: link,
        source: 'ArXiv',
        category: 'AI' as CategoryKey,
      });

      if (articles.length >= 8) break;
    }

    return articles;
  } catch {
    console.warn('[collector] ArXiv fetch failed');
    return [];
  }
}

// ─── GitHub Trending ──────────────────────────────────────────────────────────

interface GithubTrendingRepo {
  name: string;
  description: string;
  language: string;
  stars: number;
  starsDelta: number;
  url: string;
}

async function fetchGithubTrending(): Promise<RawArticle[]> {
  // GitHub Trending page — scrape HTML (no auth needed for public trending)
  const articles: RawArticle[] = [];

  for (const lang of ['python', 'typescript']) {
    try {
      const url = `https://github.com/trending/${lang}?since=daily`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;

      const html = await res.text();

      // Extract repo articles from trending page HTML
      const repoBlocks = html.matchAll(/<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/gi);
      let count = 0;

      for (const block of repoBlocks) {
        if (count >= 5) break;
        const content = block[1];

        // Repo name (owner/repo)
        const nameMatch = content.match(/href="\/([^"\/]+\/[^"\/]+)"/);
        const repoPath = nameMatch?.[1] ?? '';
        if (!repoPath) continue;

        // Description
        const descMatch = content.match(/<p[^>]*>\s*([\s\S]*?)\s*<\/p>/);
        const description = descMatch?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? '';

        // Stars delta today
        const deltaMatch = content.match(/([\d,]+)\s*stars today/i);
        const starsDelta = deltaMatch ? parseInt(deltaMatch[1].replace(/,/g, ''), 10) : 0;

        // Total stars
        const starsMatch = content.match(/aria-label="star"[\s\S]*?>([\d,]+)/i) ??
          content.match(/([\d,\.]+k?)\s*\n.*?stars/i);
        const starsRaw = starsMatch?.[1]?.replace(/,/g, '').trim() ?? '0';
        const stars = starsRaw.endsWith('k')
          ? Math.round(parseFloat(starsRaw) * 1000)
          : parseInt(starsRaw, 10) || 0;

        // AI keyword filter
        const fullText = `${repoPath} ${description}`.toLowerCase();
        const aiKeywords = ['ai', 'llm', 'ml', 'machine learning', 'agent', 'gpt', 'transformer', 'neural', 'model', 'diffusion', 'embedding', 'rag', 'inference'];
        const isAiRelated = aiKeywords.some((kw) => fullText.includes(kw));
        if (!isAiRelated) continue;

        articles.push({
          title: `[GitHub Trending] ${repoPath} — ${description || 'AI/ML 오픈소스'}`,
          content: `${description} | Language: ${lang} | Stars today: +${starsDelta} | Total stars: ${stars}`,
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

// ─── AI Company Blogs (RSS) ────────────────────────────────────────────────────

const AI_BLOG_SOURCES: NewsSource[] = [
  { name: 'OpenAI Blog', url: 'https://openai.com/blog/rss/', category: 'AI' },
  { name: 'Anthropic News', url: 'https://www.anthropic.com/news/rss.xml', category: 'AI' },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', category: 'AI' },
  { name: 'Meta AI Blog', url: 'https://ai.meta.com/blog/feed/', category: 'AI' },
  { name: 'Mistral AI', url: 'https://mistral.ai/news/rss', category: 'AI' },
];

// ─── Dedup + Merge ─────────────────────────────────────────────────────────────

function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().split(/[\s\-_,.()\[\]]+/).filter((t) => t.length > 1),
  );
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Merge threshold from CMP-131: 0.80~0.85 range — use 0.80 to catch more cross-source dups
const MERGE_THRESHOLD = 0.80;

function deduplicateAndMerge(articles: RawArticle[], limit: number): RawArticle[] {
  // Step 1: URL dedup
  const urlSeen = new Set<string>();
  const urlDeduped = articles.filter((a) => {
    if (urlSeen.has(a.url)) return false;
    urlSeen.add(a.url);
    return true;
  });

  // Step 2: Title-similarity merge (Jaccard >= 0.80)
  const unique: RawArticle[] = [];
  for (const a of urlDeduped) {
    // GitHub Trending items are never merged with regular articles
    if (a.isGithubTrending) {
      unique.push({ ...a, sourceCount: 1, sourceList: [a.source] });
      continue;
    }

    const tokA = titleTokens(a.title);
    let merged = false;
    for (const u of unique) {
      if (u.isGithubTrending) continue;
      if (jaccardSim(tokA, titleTokens(u.title)) >= MERGE_THRESHOLD) {
        u.sourceCount = (u.sourceCount ?? 1) + 1;
        u.sourceList = [...(u.sourceList ?? [u.source]), a.source].filter(
          (s, i, arr) => arr.indexOf(s) === i,
        );
        merged = true;
        break;
      }
    }
    if (!merged) {
      unique.push({ ...a, sourceCount: 1, sourceList: [a.source] });
    }
  }

  return unique.slice(0, limit);
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Collect articles per category.
 * AI category gets extra sources: HN + Reddit + ArXiv + GitHub Trending + company blogs.
 */
export async function collectByCategory(
  limit = 12,
): Promise<Map<CategoryKey, RawArticle[]>> {
  const sources = loadSources();

  // Fetch all RSS feeds concurrently
  const rssFetches = sources.map(fetchFeed);
  const rssResults = await Promise.allSettled(rssFetches);

  const byCategory = new Map<CategoryKey, RawArticle[]>();

  rssResults.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const articles = result.value;
    const cat = toCategoryKey(sources[i].category);
    const existing = byCategory.get(cat) ?? [];
    byCategory.set(cat, [...existing, ...articles]);
  });

  // AI category: fetch extra sources in parallel
  const [hnArticles, mlArticles, llamaArticles, arxivArticles, githubArticles, ...blogResults] =
    await Promise.allSettled([
      fetchHackerNews(),
      fetchRedditSubreddit('MachineLearning'),
      fetchRedditSubreddit('LocalLLaMA'),
      fetchArxiv(),
      fetchGithubTrending(),
      ...AI_BLOG_SOURCES.map(fetchFeed),
    ]);

  const aiExtra: RawArticle[] = [];
  for (const r of [hnArticles, mlArticles, llamaArticles, arxivArticles, githubArticles, ...blogResults]) {
    if (r.status === 'fulfilled') aiExtra.push(...r.value);
  }

  const existingAI = byCategory.get('AI') ?? [];
  byCategory.set('AI', [...existingAI, ...aiExtra]);

  // Dedup + merge per category
  for (const [cat, articles] of byCategory.entries()) {
    // For AI, keep GitHub Trending items separate — don't count against the limit
    const trending = articles.filter((a) => a.isGithubTrending);
    const regular = articles.filter((a) => !a.isGithubTrending);
    const mergedRegular = deduplicateAndMerge(regular, limit);
    // Append up to 8 trending repos after regular news
    const mergedTrending = deduplicateAndMerge(trending, 8);
    byCategory.set(cat, cat === 'AI' ? [...mergedRegular, ...mergedTrending] : mergedRegular);
  }

  return byCategory;
}
