import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';

function extractTag(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 'is');
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
}

export async function collectArxiv(): Promise<RawArticle[]> {
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
      articles.push({
        title,
        content: summary.slice(0, 800),
        url: link,
        source: 'ArXiv',
        category: 'AI' as const,
        publishedAt: publishedStr || undefined,
      });
      if (articles.length >= 10) break;
    }
    return articles;
  } catch {
    console.warn('[collector:arxiv] fetch failed');
    return [];
  }
}
