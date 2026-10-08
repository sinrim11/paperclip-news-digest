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

/** Atom은 링크가 태그 본문이 아니라 `<link href="…"/>` 속성에 있다. rel=alternate가 본문 링크. */
function extractAtomLink(block: string): string | null {
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    ?? block.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i)
    ?? block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return alt ? alt[1].trim() : null;
}

/**
 * RSS(`<item>`)와 Atom(`<entry>`) 양쪽을 읽는다.
 *
 * 2026-09-14: 종전에는 `<item>`만 봤다. The Verge AI가 Atom으로 바뀐 뒤로 HTTP 200을
 * 받으면서 0건이 계속됐는데, 실패로 잡히지 않아 아무도 몰랐다. 매체가 피드 형식을 바꾸는 건
 * 흔한 일이라 파서 쪽에서 흡수하는 게 맞다.
 */
export function parseRssItems(xml: string, source: RssSource): RawArticle[] {
  const items: RawArticle[] = [];
  const isAtom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const itemMatches = isAtom
    ? xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)
    : xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);

  for (const match of itemMatches) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = isAtom
      ? extractAtomLink(block) || extractTag(block, 'id')
      : extractTag(block, 'link') || extractTag(block, 'guid');
    const description = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
    if (!title || !link) continue;

    const content = description
      ? description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    // 구글뉴스 검색 피드는 집계라 매체가 매 기사 다르다. `<source url="…">매체명</source>`에
    // 원 매체가 담겨 오므로 그걸 출처로 쓴다 — 안 그러면 전부 "Google News"가 되어
    // 어느 신문 기사인지 사라진다. 제목 끝 " - 매체명"도 같은 값일 때만 떼어낸다
    // (`" - .*$"`로 뭉개면 하이픈 들어간 제목이 잘린다).
    const originSrc = extractTag(block, 'source')?.replace(/<[^>]+>/g, '').trim();
    let cleanTitle = title.replace(/<[^>]+>/g, '').trim();
    if (originSrc && cleanTitle.endsWith(` - ${originSrc}`)) {
      cleanTitle = cleanTitle.slice(0, -(originSrc.length + 3)).trim();
    }

    items.push({
      title: cleanTitle,
      content: content.slice(0, 2000),
      url: link.trim(),
      source: originSrc ? `${originSrc} (via ${source.name})` : source.name,
      category: toCategoryKey(source.category),
      publishedAt: pubDate ?? undefined,
    });

    if (items.length >= 15) break;
  }
  return items;
}

/**
 * 죽은 피드는 반드시 로그를 남긴다.
 *
 * 종전에는 `!res.ok`가 조용히 `[]`를 반환했다. 그 결과 AI 1차 출처 5개 중 4개(OpenAI 403 ·
 * Anthropic 404 · Meta 404)가 언제부터인지 모르게 죽어 있었는데도 파이프라인은 정상으로
 * 보였다 — 다른 소스가 기사를 채우니 총량이 줄지 않는다. 조용한 0건이 가장 오래 산다.
 *
 * 200인데 0건인 경우도 경고한다. 파서가 `<item>`만 보므로 Atom(`<entry>`) 피드로 바뀌면
 * HTTP는 성공인 채 결과만 비는데, 이쪽이 더 눈에 안 띈다.
 */
export async function fetchFeed(source: RssSource): Promise<RawArticle[]> {
  try {
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[collector:rss] DEAD ${source.name} — HTTP ${res.status} ${source.url}`);
      return [];
    }
    const xml = await res.text();
    const items = parseRssItems(xml, source);
    if (items.length === 0) {
      const atom = /<entry[\s>]/i.test(xml) ? ' (Atom <entry> 피드 — 파서는 <item>만 읽음)' : '';
      console.warn(`[collector:rss] EMPTY ${source.name} — HTTP 200이지만 0건${atom} ${source.url}`);
    }
    return items;
  } catch (err) {
    console.warn(`[collector:rss] DEAD ${source.name} — ${String(err)} ${source.url}`);
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
