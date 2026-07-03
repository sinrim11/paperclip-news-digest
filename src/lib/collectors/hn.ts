import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';

export async function collectHN(): Promise<RawArticle[]> {
  assertSourceAllowed('hn');
  try {
    const since = Math.floor(Date.now() / 1000) - 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=AI+LLM+machine+learning&tags=story&numericFilters=created_at_i>${since},points>50&hitsPerPage=15`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hits: Array<{ title: string; url?: string; objectID: string; points: number; author: string }>;
    };
    return (data.hits ?? [])
      .filter((h) => h.title && (h.url || h.objectID))
      .slice(0, 10)
      .map((h) => ({
        title: h.title,
        content: `HackerNews points: ${h.points} | by ${h.author}`,
        url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: 'HackerNews',
        category: 'AI' as const,
      }));
  } catch {
    console.warn('[collector:hn] fetch failed');
    return [];
  }
}
