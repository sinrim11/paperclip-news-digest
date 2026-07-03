import type { RawArticle, CategoryKey } from '../types';
import { toCategoryKey } from '../types';
import { assertSourceAllowed } from '../source-guard';

export interface RssSource {
  name: string;
  url: string;
  category: string;
}

function extractTag(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 'is');
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
}

export function parseRssItems(xml: string, source: RssSource): RawArticle[] {
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

export async function fetchFeed(source: RssSource): Promise<RawArticle[]> {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return parseRssItems(await res.text(), source);
  } catch {
    console.warn(`[collector:rss] failed to fetch ${source.name}`);
    return [];
  }
}

export async function collectRss(sources: RssSource[]): Promise<Map<CategoryKey, RawArticle[]>> {
  assertSourceAllowed('rss');
  const results = await Promise.allSettled(sources.map(fetchFeed));
  const bySourceAndCat = new Map<CategoryKey, RawArticle[][]>();

  results.forEach((result, i) => {
    if (result.status !== 'fulfilled' || result.value.length === 0) return;
    const cat = toCategoryKey(sources[i].category);
    if (!bySourceAndCat.has(cat)) bySourceAndCat.set(cat, []);
    bySourceAndCat.get(cat)!.push(result.value);
  });

  const out = new Map<CategoryKey, RawArticle[]>();
  for (const [cat, sourceLists] of bySourceAndCat.entries()) {
    // Round-robin interleave so no single feed dominates
    const interleaved: RawArticle[] = [];
    const maxLen = Math.max(...sourceLists.map((s) => s.length));
    for (let i = 0; i < maxLen; i++)
      for (const list of sourceLists)
        if (i < list.length) interleaved.push(list[i]);
    out.set(cat, interleaved);
  }
  return out;
}
