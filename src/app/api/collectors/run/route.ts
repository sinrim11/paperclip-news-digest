import { NextResponse } from 'next/server';
import { collectRss } from '@/lib/collectors/rss';
import { collectGithub } from '@/lib/collectors/github';
import { collectHN } from '@/lib/collectors/hn';
import { collectArxiv } from '@/lib/collectors/arxiv';
import { collectPwC } from '@/lib/collectors/pwc';
import { collectNewsletter } from '@/lib/collectors/newsletter';
import { persistArticles, persistEntityStats } from '@/lib/collectors/persist';

interface CollectorResult {
  name: string;
  count: number;
  error?: string;
}

async function runCollector(
  name: string,
  fn: () => Promise<unknown[]>,
  sourceType: string,
  withEntityStats = false
): Promise<CollectorResult> {
  try {
    const articles = await fn() as import('@/lib/types').RawArticle[];
    const count = await persistArticles(articles, sourceType);
    if (withEntityStats) await persistEntityStats(articles, sourceType);
    return { name, count };
  } catch (err) {
    return { name, count: 0, error: String(err) };
  }
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Load RSS sources
  let rssSources: import('@/lib/collectors/rss').RssSource[] = [];
  try {
    const { default: data } = await import('@/../config/news_sources.json');
    rssSources = (data as { news_sources: import('@/lib/collectors/rss').RssSource[] }).news_sources ?? [];
  } catch {
    // no sources config
  }

  const results = await Promise.allSettled([
    runCollector('rss', () => collectRss(rssSources).then(m => [...m.values()].flat()), 'rss'),
    runCollector('github', collectGithub, 'github', true),
    runCollector('hn', collectHN, 'hn'),
    runCollector('arxiv', collectArxiv, 'arxiv', true),
    runCollector('pwc', collectPwC, 'pwc', true),
    runCollector('newsletter', collectNewsletter, 'newsletter'),
  ]);

  const summary = results.map(r => r.status === 'fulfilled' ? r.value : { name: 'unknown', count: 0, error: String((r as PromiseRejectedResult).reason) });
  const total = summary.reduce((s, r) => s + r.count, 0);

  console.log('[collector-pipeline] results:', summary);

  return NextResponse.json({ ok: true, total, results: summary });
}
