import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';

export async function collectPwC(): Promise<RawArticle[]> {
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
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return (data.results ?? [])
      .filter((p) => p.title && p.url_abs)
      .filter((p) => !p.published || new Date(p.published).getTime() >= cutoff)
      .slice(0, 10)
      .map((p) => ({
        title: p.title,
        content: (p.abstract ?? '').slice(0, 800) || `Papers with Code | repos: ${p.repository_count}`,
        url: p.url_abs,
        source: 'Papers with Code',
        category: 'AI' as const,
        publishedAt: p.published || undefined,
      }));
  } catch {
    console.warn('[collector:pwc] fetch failed');
    return [];
  }
}
