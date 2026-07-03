import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';
import { fetchFeed, type RssSource } from './rss';

const NEWSLETTER_SOURCES: RssSource[] = [
  { name: 'The Batch (DeepLearning.AI)', url: 'https://www.deeplearning.ai/the-batch/feed/', category: 'AI' },
  { name: 'Import AI',                   url: 'https://importai.substack.com/feed',          category: 'AI' },
  { name: 'TLDR AI',                     url: 'https://tldr.tech/ai/rss',                    category: 'AI' },
  { name: 'Last Week in AI',             url: 'https://lastweekin.ai/feed',                  category: 'AI' },
];

export async function collectNewsletter(): Promise<RawArticle[]> {
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
