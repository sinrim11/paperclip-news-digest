import type { RawArticle } from '../types';
import { assertSourceAllowed } from '../source-guard';

function extractTag(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 'is');
  const m = xml.match(pattern);
  return m ? m[1].trim() : null;
}

/**
 * arXiv는 동시 요청에 민감하다 — collectByCategory가 8개 수집기를 한 번에 쏘면 이쪽만 연결을
 * 끊는 일이 잦다(직접 프로브하면 늘 200). 2026-09-14 점검에서 로그에 `fetch failed`가 간헐적으로
 * 찍혔는데, 실패해도 다른 소스가 AI 카테고리를 채워 눈에 띄지 않았다. API 가이드가 권하는
 * 3초 간격으로 한 번 재시도한다.
 */
export async function collectArxiv(): Promise<RawArticle[]> {
  assertSourceAllowed('arxiv');
  try {
    // 공백으로 쓴다(2026-10-08). 종전 'cat:cs.AI+OR+…'은 encodeURIComponent가 '+'를 %2B(리터럴 +)로
    // 바꿔 arXiv가 한 덩어리 검색어로 읽고 totalResults=0을 돌려줬다 — 9/16부터 23일 연속 EMPTY의 원인.
    // HTTP 200이라 '48시간 필터가 맞다'는 가설로 오래 버텼다. 공백은 %20 → 정상 OR 검색.
    const cats = 'cat:cs.AI OR cat:cs.CL OR cat:cs.LG';
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(cats)}&sortBy=submittedDate&sortOrder=descending&max_results=20`;
    const once = () => fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' },
      signal: AbortSignal.timeout(12_000),
    });
    let res: Response;
    try {
      res = await once();
    } catch (first) {
      console.warn(`[collector:arxiv] 1차 실패, 3초 후 재시도 — ${String(first).slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 3_000));
      res = await once();
    }
    if (!res.ok) {
      console.warn(`[collector:arxiv] DEAD — HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const articles: RawArticle[] = [];
    // arXiv는 주말에 공지가 없다 — 48시간이면 월요일 아침이 늘 0건이라 96시간으로 둔다(최신 10건만 쓰므로 품질 영향 없음).
    const cutoff = Date.now() - 96 * 60 * 60 * 1000;

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
    if (articles.length === 0) console.warn('[collector:arxiv] EMPTY — 응답은 받았으나 최근 96시간 논문 0건');
    return articles;
  } catch (err) {
    console.warn(`[collector:arxiv] DEAD — 재시도 후에도 실패: ${String(err).slice(0, 100)}`);
    return [];
  }
}
