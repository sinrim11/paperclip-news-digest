import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';
import { fetchFeed, type RssSource } from './rss';

// 2026-09-14 점검: 4개 중 2개가 404였다(The Batch 폐지 · TLDR 경로 변경).
// fetchFeed가 죽은 피드를 조용히 넘기던 탓에 언제부터인지 알 수 없다 — 이제 DEAD 로그가 남는다.
const NEWSLETTER_SOURCES: RssSource[] = [
  { name: 'Import AI',       url: 'https://importai.substack.com/feed', category: 'AI' },
  { name: 'TLDR AI',         url: 'https://tldr.tech/api/rss/ai',       category: 'AI' }, // 구 /ai/rss 는 404
  { name: 'Last Week in AI', url: 'https://lastweekin.ai/feed',         category: 'AI' },
  { name: 'Interconnects',   url: 'https://www.interconnects.ai/feed',  category: 'AI' }, // The Batch(피드 폐지) 대체
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
