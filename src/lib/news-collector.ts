/**
 * RSS-based news collector.
 * Reads sources from config/news_sources.json, fetches each feed,
 * and returns raw articles grouped by category for LLM processing.
 *
 * NOTE: No web_search tool — collection is pure HTTP RSS.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { CategoryKey, RawArticle } from './types';
import { toCategoryKey } from './types';

interface NewsSource {
  name: string;
  url: string;
  category: string; // Korean label in JSON; converted to CategoryKey on read
}

function loadSources(): NewsSource[] {
  const configPath = join(process.cwd(), 'config', 'news_sources.json');
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as { news_sources: NewsSource[] };
  return parsed.news_sources;
}

/** Minimal RSS parser — no dependency needed, just XML text scraping. */
function parseRssItems(xml: string, source: NewsSource): RawArticle[] {
  const items: RawArticle[] = [];

  // Extract <item> blocks
  const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const block = match[1];

    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || extractTag(block, 'guid');
    const description = extractTag(block, 'description') || extractTag(block, 'summary');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published');

    if (!title || !link) continue;

    // Strip HTML tags from description
    const content = description
      ? description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    items.push({
      title: title.replace(/<[^>]+>/g, '').trim(),
      content: content.slice(0, 2000), // cap to avoid token bloat
      url: link.trim(),
      source: source.name,
      category: toCategoryKey(source.category),
      publishedAt: pubDate ?? undefined,
    });

    if (items.length >= 15) break; // cap per feed
  }

  return items;
}

/** Tokenize a title for Jaccard similarity comparison */
function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().split(/[\s\-_,.()\[\]]+/).filter((t) => t.length > 1),
  );
}

/** Jaccard similarity between two token sets */
function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function extractTag(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 'is');
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
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

/**
 * Collect up to `limit` articles per category from all configured RSS feeds.
 * Returns a map of category → RawArticle[].
 */
export async function collectByCategory(
  limit = 12,
): Promise<Map<CategoryKey, RawArticle[]>> {
  const sources = loadSources();

  // Fetch all feeds concurrently
  const results = await Promise.allSettled(sources.map(fetchFeed));

  const byCategory = new Map<CategoryKey, RawArticle[]>();

  results.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const articles = result.value;
    const cat = toCategoryKey(sources[i].category);

    const existing = byCategory.get(cat) ?? [];
    byCategory.set(cat, [...existing, ...articles]);
  });

  // Deduplicate by URL and title similarity, accumulate source metadata
  for (const [cat, articles] of byCategory.entries()) {
    // Step 1: URL dedup
    const urlSeen = new Set<string>();
    const urlDeduped = articles.filter((a) => {
      if (urlSeen.has(a.url)) return false;
      urlSeen.add(a.url);
      return true;
    });

    // Step 2: Title-similarity dedup (Jaccard >= 0.85 → same story)
    // Accumulate sourceCount and sourceList on the surviving article
    const unique: RawArticle[] = [];
    for (const a of urlDeduped) {
      const tokA = titleTokens(a.title);
      let merged = false;
      for (const u of unique) {
        if (jaccardSim(tokA, titleTokens(u.title)) >= 0.85) {
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

    byCategory.set(cat, unique.slice(0, limit));
  }

  return byCategory;
}
