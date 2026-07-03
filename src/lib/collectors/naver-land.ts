/**
 * 네이버 부동산 매물 스냅샷 수집기 (보조 지표 — 호가·매물 수).
 *
 * 방식(2026-07-03, RealEstateApp_v2 scraper_module.py에서 이식):
 *   직접 HTTP는 차단(TOO_MANY_REQUESTS)되므로 Playwright 헤드리스로
 *   fin.land.naver.com/complexes/{n}?tab=article 페이지를 실제 방문한 뒤,
 *   그 페이지 컨텍스트 안에서 fetch로 front-api/v1/complex/article/list를 호출.
 *
 * 정책: 하루 1회, config/naver-watchlist.json의 관심 단지만, 단지 간 3~5초 간격.
 * 파손 전제 설계 — 실패해도 파이프라인에 영향 없음. 의사결정 코어는 국토부 실거래.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { PrismaClient } from '@prisma/client';
import type { Page } from 'playwright';

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const UA_PC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

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

/** m.land 검색 302 redirect에서 단지번호 추출 (HTTP만으로 동작 확인됨) */
export async function resolveComplexNo(keyword: string): Promise<string | null> {
  try {
    const res = await fetch(`https://m.land.naver.com/search/result/${encodeURIComponent(keyword)}`, {
      headers: { 'User-Agent': UA_MOBILE },
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

// ─── fin.land front-api — 패시브 감청 방식 ────────────────────────────────────
// 직접 fetch(curl·APIRequestContext·in-page 모두)는 429/차단이지만, NNB 쿠키를
// 가진 브라우저로 단지 페이지를 열면 프런트엔드가 스스로 article/list·article/count를
// 호출한다(2026-07-03 네트워크 캡처로 확인). 그 응답을 page.on('response')로 수확.

interface HarvestResult {
  articles: unknown[];
  totalCount: number | null;
}

async function harvestComplexArticles(page: Page, complexNo: string): Promise<HarvestResult> {
  const articles: unknown[] = [];
  let totalCount: number | null = null;

  const digest = (url: string, text: string) => {
    try {
      const data = JSON.parse(text) as { result?: unknown };
      if (url.includes('/article/list')) {
        const list = (data?.result as { list?: unknown[] } | undefined)?.list;
        if (list) articles.push(...list);
      } else if (url.includes('/article/count')) {
        if (typeof data?.result === 'number') totalCount = data.result;
        else if (data?.result && typeof data.result === 'object') {
          const n = Object.values(data.result as Record<string, unknown>).find((v) => typeof v === 'number');
          if (typeof n === 'number') totalCount = n;
        }
      }
    } catch {
      /* JSON 아니면 무시 */
    }
  };

  // route로 가로채 body를 우리가 먼저 확보 — SPA가 404로 이탈해도 응답 유실 없음
  const routePattern = '**/front-api/v1/complex/article/**';
  await page.route(routePattern, async (route) => {
    try {
      const response = await route.fetch();
      const body = await response.text();
      digest(route.request().url(), body);
      await route.fulfill({ response, body });
    } catch {
      await route.continue().catch(() => {});
    }
  });

  try {
    await page
      .goto(`https://fin.land.naver.com/complexes/${complexNo}?tab=article`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
      .catch(() => {});
    await page.waitForTimeout(8_000); // SPA가 API를 쏠 시간
  } finally {
    await page.unroute(routePattern).catch(() => {});
  }
  return { articles, totalCount };
}

// ─── 가격 파싱 (스키마 적응형) ────────────────────────────────────────────────

interface RepInfo {
  tradeType?: string;
  priceInfo?: Record<string, unknown>;
  [k: string]: unknown;
}

function repInfoOf(article: unknown): RepInfo {
  const a = article as { representativeArticleInfo?: RepInfo };
  return a?.representativeArticleInfo ?? (article as RepInfo);
}

/** 객체를 DFS로 훑어 매매가로 보이는 숫자(만원, 1천만~100억)를 수집 */
function findPricesManwon(obj: unknown, depth = 0): number[] {
  if (depth > 4 || obj === null || typeof obj !== 'object') return [];
  const out: number[] = [];
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === 'number' && /pr(i)?ce|prc|amount/i.test(key) && val >= 1_000 && val <= 1_000_000) {
      out.push(val);
    } else if (typeof val === 'string' && /pr(i)?ce|prc/i.test(key)) {
      // "5억 5,000" 또는 "55,000" 형태
      const m = val.match(/(?:(\d+)억)?\s*([\d,]{2,})?/);
      if (m && (m[1] || m[2])) {
        const n = (m[1] ? parseInt(m[1], 10) * 10_000 : 0) + (m[2] ? parseInt(m[2].replace(/,/g, ''), 10) : 0);
        if (n >= 1_000 && n <= 1_000_000) out.push(n);
      }
    } else if (typeof val === 'object') {
      out.push(...findPricesManwon(val, depth + 1));
    }
  }
  return out;
}

function isDealType(rep: RepInfo): boolean {
  const t = String(rep.tradeType ?? '');
  return t === 'A1' || t === 'DEAL' || t.includes('매매');
}

/** 매매 호가 (만원). priceInfo.dealPrice는 원 단위(2026-07-03 확인) — 만원 변환 */
function dealPriceManwon(article: unknown): number | null {
  const rep = repInfoOf(article);
  const p = (rep.priceInfo as { dealPrice?: number } | undefined)?.dealPrice;
  if (typeof p === 'number' && p >= 10_000_000) return Math.round(p / 10_000);
  const cands = findPricesManwon(rep); // 스키마 변경 대비 폴백
  return cands.length ? Math.max(...cands) : null;
}

// ─── 메인 수집 ────────────────────────────────────────────────────────────────

/** 워치리스트 단지 매물 스냅샷 수집. 저장 건수 반환 (실패 비치명) */
export async function collectListingSnapshots(prisma: PrismaClient): Promise<number> {
  const watchlist = loadWatchlist();
  if (watchlist.length === 0) return 0;

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.warn('[naver] playwright 미설치 — 매물 수집 skip');
    return 0;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let saved = 0;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: UA_PC,
      locale: 'ko-KR',
      viewport: { width: 1400, height: 900 },
    });
    await context.addInitScript(`() => {
      Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
      Object.defineProperty(navigator, 'languages', {get: () => ['ko-KR','ko']});
      Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
      window.chrome = window.chrome || { runtime: {} };
    }`);
    const page = await context.newPage();

    // NNB 디바이스 쿠키 확보 — 없으면 fin.land가 /map으로 튕김 (2026-07-03 확인)
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    for (const c of watchlist) {
      const complexNo = c.complexNo ?? (c.keyword ? await resolveComplexNo(c.keyword) : null);
      if (!complexNo) {
        console.warn(`[naver] ${c.name}: 단지번호 해석 실패`);
        continue;
      }
      try {
        const { articles, totalCount } = await harvestComplexArticles(page, complexNo);
        const deals = articles.filter((a) => isDealType(repInfoOf(a)));
        const prices = deals.map(dealPriceManwon).filter((p): p is number => p !== null);

        if (articles.length === 0 && totalCount === null) {
          console.warn(`[naver] ${c.name}(${complexNo}): 응답 캡처 실패 — skip`);
        } else {
          const articleCount = totalCount ?? deals.length;
          await prisma.listingSnapshot.upsert({
            where: { complexNo_date_tradeType: { complexNo, date: today, tradeType: 'A1' } },
            create: {
              complexNo,
              complexName: c.name,
              date: today,
              tradeType: 'A1',
              articleCount,
              minPrice: prices.length ? Math.min(...prices) : null,
              maxPrice: prices.length ? Math.max(...prices) : null,
              raw: JSON.parse(JSON.stringify({ sample: articles[0] ?? null, captured: articles.length })) as object,
            },
            update: {
              articleCount,
              minPrice: prices.length ? Math.min(...prices) : null,
              maxPrice: prices.length ? Math.max(...prices) : null,
            },
          });
          console.log(
            `[naver] ${c.name}(${complexNo}): 매물 ${articleCount}건(캡처 ${articles.length}), 매매호가 ${prices.length ? (Math.min(...prices) / 10000).toFixed(1) + '~' + (Math.max(...prices) / 10000).toFixed(1) + '억' : '파싱 불가'}`,
          );
          saved++;
        }
      } catch (err) {
        console.warn(`[naver] ${c.name}(${complexNo}) 수집 실패:`, err);
      }
      await page.waitForTimeout(3_000 + Math.floor(Math.random() * 2_000));
    }
  } finally {
    await browser.close();
  }
  return saved;
}
