/**
 * _naver-harvest.ts — 3개 후보 단지 네이버 실매물 호가 vs 국토부 실거래 갭(급매 진단). 1회성.
 * 앱 수집기(naver-land.ts) 재사용: resolveComplexNo + harvestComplexArticles(Playwright 패시브 감청).
 * 실행: npx tsx scripts/_naver-harvest.ts
 */
import { PrismaClient } from '@prisma/client';
import { harvestComplexArticles, resolveComplexNo, repInfoOf, isDealType, dealPriceManwon } from '../src/lib/collectors/naver-land';
import type { Page } from 'playwright';

const TARGETS = [
  { key: 'clforet', name: '안양씨엘포레자이', gu: '안양 만안구', dong: '안양동', lawd: '41171', nameLike: '씨엘포레자이', complexNo: '121645' },
  { key: 'pyeongchon', name: '평촌신원아침도시', gu: '안양 동안구', dong: '호계동', lawd: '41173', nameLike: '신원아침도시', complexNo: '132112' },
  { key: 'doksan', name: 'e편한세상독산더타워', gu: '금천구', dong: '독산동', lawd: '11545', nameLike: 'e편한세상독산더타워', complexNo: '' },
];

const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** article에서 전용면적(㎡) 추정 — 30~200 범위, area/space/exclu 키 우선 */
function findAreaM2(obj: unknown, depth = 0): number | null {
  if (depth > 4 || obj === null || typeof obj !== 'object') return null;
  let best: number | null = null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'number' && /(exclu|area|space|spc)/i.test(k) && v >= 25 && v <= 220) {
      if (/exclu/i.test(k)) return v; // 전용 우선 즉시 반환
      if (best === null) best = v;
    } else if (typeof v === 'string' && /(exclu|area|space)/i.test(k)) {
      const n = parseFloat(v.replace(/[^\d.]/g, ''));
      if (n >= 25 && n <= 220 && /exclu/i.test(k)) return n;
    } else if (typeof v === 'object') {
      const r = findAreaM2(v, depth + 1);
      if (r !== null && /exclu/i.test(JSON.stringify(Object.keys(v as object)))) return r;
      if (r !== null && best === null) best = r;
    }
  }
  return best;
}

/** 브라우저 내에서 단지 검색 → complexNo 해석 폴백 */
async function resolveInBrowser(page: Page, keyword: string): Promise<string | null> {
  try {
    await page.goto('https://m.land.naver.com/search/result/' + encodeURIComponent(keyword), { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const u = page.url();
    let m = u.match(/\/complex\/info\/(\d+)/) || u.match(/\/complexes\/(\d+)/);
    if (m) return m[1];
    const href = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a')).map((x) => (x as HTMLAnchorElement).href);
      return a.find((h) => /\/complex\/info\/\d+/.test(h) || /\/complexes\/\d+/.test(h)) || '';
    }).catch(() => '');
    m = href.match(/\/complex\/info\/(\d+)/) || href.match(/\/complexes\/(\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

(async () => {
  const prisma = new PrismaClient();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', locale: 'ko-KR', viewport: { width: 1400, height: 900 } });
  await context.addInitScript(`() => { Object.defineProperty(navigator,'webdriver',{get:()=>undefined}); window.chrome=window.chrome||{runtime:{}}; }`);
  const page = await context.newPage();
  await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const since = new Date(Date.now() - 180 * 86400000);

  for (const t of TARGETS) {
    let complexNo = t.complexNo;
    if (!complexNo) {
      complexNo = (await resolveComplexNo(t.nameLike)) || (await resolveInBrowser(page, t.name)) || (await resolveInBrowser(page, t.nameLike)) || '';
    }
    console.log('\n════════════════════════════════════════');
    console.log(`■ ${t.name} (${t.gu} ${t.dong}) · complexNo ${complexNo || '해석실패'}`);
    console.log('════════════════════════════════════════');

    // ── 실거래(AptTrade) 면적밴드별 집계 ──
    const trades = await prisma.aptTrade.findMany({ where: { lawdCd: t.lawd, dong: t.dong, dealDate: { gte: since } }, select: { aptName: true, excluUseAr: true, dealAmount: true, floor: true, dealDate: true } });
    const mine = trades.filter((r) => r.aptName.includes(t.nameLike));
    const band = (a: number) => (a < 40 ? '~40' : a < 60 ? '50평대(50~59㎡)' : a < 75 ? '59~74㎡' : a < 90 ? '84㎡급(75~89㎡)' : '90㎡+');
    const byBand: Record<string, { p: number[]; latest: number; latestMs: number }> = {};
    for (const r of mine) {
      const b = band(r.excluUseAr); byBand[b] = byBand[b] || { p: [], latest: 0, latestMs: 0 };
      byBand[b].p.push(r.dealAmount);
      if (r.dealDate.getTime() > byBand[b].latestMs) { byBand[b].latestMs = r.dealDate.getTime(); byBand[b].latest = r.dealAmount; }
    }
    console.log(`\n[국토부 실거래 180일] ${mine.length}건`);
    for (const [b, v] of Object.entries(byBand)) {
      console.log(`  · ${b}: 중간 ${eok(median(v.p))} (범위 ${eok(Math.min(...v.p))}~${eok(Math.max(...v.p))}) · 최근 ${eok(v.latest)} · ${v.p.length}건`);
    }

    // ── 네이버 호가 하베스트 ──
    if (!complexNo) { console.log('\n[네이버 호가] complexNo 해석 실패 — 스킵'); await page.waitForTimeout(2000); continue; }
    const { articles, totalCount } = await harvestComplexArticles(page, complexNo);
    const deals = articles.filter((a) => isDealType(repInfoOf(a)));
    const rows = deals.map((a) => ({ price: dealPriceManwon(a), area: findAreaM2(repInfoOf(a)) })).filter((x) => x.price);
    console.log(`\n[네이버 실매물 호가] 전체매물 ${totalCount ?? '?'} · 매매 캡처 ${deals.length} · 가격파싱 ${rows.length}`);
    if (rows.length) {
      const byB: Record<string, number[]> = {};
      for (const r of rows) { const b = r.area ? band(r.area) : '면적미상'; (byB[b] = byB[b] || []).push(r.price as number); }
      for (const [b, ps] of Object.entries(byB)) {
        console.log(`  · ${b}: 호가 ${eok(Math.min(...ps))}~${eok(Math.max(...ps))} (중간 ${eok(median(ps))}) · ${ps.length}건`);
      }
      const dump = rows.slice(0, 1);
      if (dump[0] && dump[0].area == null) console.log('  (면적 파싱 실패 — 샘플 키:', Object.keys(repInfoOf(deals[0]) as object).join(','), ')');
    }
    await page.waitForTimeout(3500);
  }

  await browser.close();
  await prisma.$disconnect();
})();
