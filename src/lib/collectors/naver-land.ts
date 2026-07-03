/**
 * 네이버 부동산 매물 스냅샷 수집기 (보조 지표 — 호가·매물 수).
 *
 * 상태(2026-07-03): 비공식 엔드포인트(m.land getComplexArticleList, cluster ajax,
 * fin.land front-api)가 모두 차단/변경됨(null 또는 TOO_MANY_REQUESTS 확인).
 * → 현재는 graceful-skip 스텁. 단지번호 해석(m.land 검색 302 redirect)은 동작하므로
 *   유지하고, 매물 수집은 후속으로 Playwright 헤드리스 전환 예정.
 *
 * 정책: 하루 1회, config/naver-watchlist.json의 관심 단지만. 파손 전제로 설계 —
 * 실패해도 파이프라인에 영향 없음. 의사결정 코어는 국토부 실거래(molit.ts).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { PrismaClient } from '@prisma/client';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

interface WatchComplex {
  name: string;
  complexNo?: string;
  keyword?: string;
}

function loadWatchlist(): WatchComplex[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'config', 'naver-watchlist.json'), 'utf-8')) as {
      complexes: WatchComplex[];
    };
    return raw.complexes ?? [];
  } catch {
    return [];
  }
}

/** m.land 검색 302 redirect에서 단지번호 추출 (동작 확인됨) */
export async function resolveComplexNo(keyword: string): Promise<string | null> {
  try {
    const res = await fetch(`https://m.land.naver.com/search/result/${encodeURIComponent(keyword)}`, {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const loc = res.headers.get('location') ?? '';
    const m = loc.match(/\/complex\/info\/(\d+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 매물 목록 시도 — 현재 차단 상태라 대부분 null. 스키마 방어적 파싱 */
async function fetchArticleSnapshot(complexNo: string): Promise<{ count: number; min: number | null; max: number | null } | null> {
  try {
    const res = await fetch(
      `https://m.land.naver.com/complex/getComplexArticleList?hscpNo=${complexNo}&tradTpCd=A1&order=point_&showR0=N&page=1`,
      {
        headers: { 'User-Agent': UA, Referer: `https://m.land.naver.com/complex/info/${complexNo}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const data = (await res.json().catch(() => null)) as {
      result?: { totAtclCnt?: number; list?: Array<{ prcInfo?: string }> };
    } | null;
    if (!data?.result) return null;

    const parsePrice = (s?: string): number | null => {
      // "5억 5,000" → 55000 (만원)
      if (!s) return null;
      const m = s.match(/(?:(\d+)억)?\s*([\d,]+)?/);
      if (!m) return null;
      const eok = m[1] ? parseInt(m[1], 10) * 10_000 : 0;
      const man = m[2] ? parseInt(m[2].replace(/,/g, ''), 10) : 0;
      return eok + man || null;
    };
    const prices = (data.result.list ?? []).map((a) => parsePrice(a.prcInfo)).filter((p): p is number => p !== null);
    return {
      count: data.result.totAtclCnt ?? prices.length,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
    };
  } catch {
    return null;
  }
}

/** 워치리스트 단지 매물 스냅샷 수집. 저장 건수 반환 (차단 시 0 — 비치명) */
export async function collectListingSnapshots(prisma: PrismaClient): Promise<number> {
  const watchlist = loadWatchlist();
  if (watchlist.length === 0) return 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let saved = 0;
  for (const c of watchlist) {
    const complexNo = c.complexNo ?? (c.keyword ? await resolveComplexNo(c.keyword) : null);
    if (!complexNo) {
      console.warn(`[naver] ${c.name}: 단지번호 해석 실패`);
      continue;
    }
    const snap = await fetchArticleSnapshot(complexNo);
    if (!snap) {
      console.warn(`[naver] ${c.name}(${complexNo}): 매물 API 차단/변경 — skip`);
      continue;
    }
    await prisma.listingSnapshot.upsert({
      where: { complexNo_date_tradeType: { complexNo, date: today, tradeType: 'A1' } },
      create: { complexNo, complexName: c.name, date: today, tradeType: 'A1', articleCount: snap.count, minPrice: snap.min, maxPrice: snap.max },
      update: { articleCount: snap.count, minPrice: snap.min, maxPrice: snap.max },
    });
    saved++;
    await new Promise((r) => setTimeout(r, 3000)); // 저빈도 예의
  }
  return saved;
}
