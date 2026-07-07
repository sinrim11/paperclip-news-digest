/**
 * gen-matching.ts — 매수 매칭 분석 생성기 → config/matching-analysis.json
 *   ① 준신축 shortlist(실거래 랭킹, recommend-engine 스코어 재현)
 *   ② 추적 3단지: 실거래 band vs 네이버 호가 band + 개별 매물(층/향/특징) + 급매 자동판정
 *   ③ 정성 팩트(complex-facts.json) 조인
 * 페이지 src/app/matching/page.tsx가 이 JSON을 읽어 렌더(force-dynamic).
 * 실행: npx tsx scripts/gen-matching.ts   (네이버 하베스트 ~2분)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { tierOf, LAWD_GU } from '../src/lib/tiers';
import { harvestComplexArticles, repInfoOf, isDealType } from '../src/lib/collectors/naver-land';
import { loadPolicyParams, loadReaderFinances } from '../src/lib/tracker';
import { loadInvestmentModel, regionApprPct, type InvestmentModel } from '../src/lib/investment-model';
import { analyzeWithVersus, matchingCompact } from '../src/lib/invest-compact';
import type { PolicyParams, ReaderFinances } from '../src/lib/tracker';

/** 투자분석 compact — shortlist·tracked 공용 (2년 분석 + 10년 vs 요약) */
function investCompact(priceManwon: number, jeonseRatioPct: number, tradeCount: number, fin: ReaderFinances, params: PolicyParams, model: InvestmentModel, elapsedYear?: number | null, household?: number | null, apprBasePct?: number | null) {
  const { a, vs } = analyzeWithVersus({ priceManwon, jeonseRatioPct, tradeCount, elapsedYear, household, apprBasePct }, fin, params, model);
  return { ...matchingCompact(a), vs };
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const loadJson = <T>(rel: string): T | null => { try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')) as T; } catch { return null; } };
function dirKo(code: string): string { const m: Record<string, string> = { E: '동', W: '서', S: '남', N: '북' }; return (code || '').split('').map((c) => m[c] || c).join('') || '?'; }
function bandOf(a: number): string { return a < 40 ? '~40㎡' : a < 50 ? '40㎡대' : a < 60 ? '50㎡대' : a < 75 ? '59~74㎡' : a < 90 ? '84㎡급' : '90㎡+'; }

const TRACKED = [
  { key: 'clforet', name: '안양씨엘포레자이', gu: '안양 만안구', dong: '안양동', lawd: '41171', nameLike: '씨엘포레자이', complexNo: '121645', stamp: '투자효율·1394세대 자이', elapsed: 5, household: 1394 },
  { key: 'pyeongchon', name: '평촌신원아침도시', gu: '안양 동안구', dong: '호계동', lawd: '41173', nameLike: '신원아침도시', complexNo: '132112', stamp: '학군임대·평촌 학원가', elapsed: 4, household: 144 },
  { key: 'doksan', name: 'e편한세상독산더타워', gu: '금천구', dong: '독산동', lawd: '11545', nameLike: 'e편한세상독산더타워', complexNo: '115472', stamp: '서울잔류·직주근접', elapsed: 7, household: 432 },
];

interface Fact { match: { gu: string; dong?: string; nameIncludes: string }; station?: string; catalyst?: string; school?: string; amenities?: string; living?: string; reasons?: string[]; cautions?: string[]; sources?: string[] }

function liquidity(count: number, cap: number) { let s = count >= 40 ? 16 : count >= 25 ? 13 : count >= 15 ? 11 : count >= 10 ? 9 : count >= 6 ? 6 : 4; return Math.min(cap, s); }

async function buildShortlist(prisma: PrismaClient, rules: any, ctx: any) {
  const comfortable = ctx?.budgetReality?.comfortableCeilingManwon ?? rules.budgetFallback.comfortableCeilingManwon;
  const stretch = ctx?.budgetReality?.stretchCeilingManwon ?? rules.budgetFallback.stretchCeilingManwon;
  const regionHeat: Record<string, number> = ctx?.regionHeat ?? {};
  const nowYear = new Date(Date.now() + 9 * 3_600_000).getUTCFullYear();
  const since = new Date(Date.now() - rules.filters.lookbackDays * 86_400_000);
  const rows = await prisma.aptTrade.findMany({ where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, dealAmount: { lte: stretch } }, select: { lawdCd: true, dong: true, aptName: true, dealAmount: true, excluUseAr: true, buildYear: true } });
  const rentRows = await prisma.aptRent.findMany({ where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, monthlyRent: 0 }, select: { lawdCd: true, dong: true, aptName: true, deposit: true } });
  const jMap = new Map<string, number[]>();
  const nn = (s: string) => s.replace(/\s|아파트/g, '');
  for (const r of rentRows) { const k = `${r.lawdCd}|${r.dong}|${nn(r.aptName)}`; (jMap.get(k) ?? jMap.set(k, []).get(k)!).push(r.deposit); }
  const aggs = new Map<string, any>();
  for (const r of rows) { const gu = LAWD_GU[r.lawdCd] ?? r.lawdCd; const key = `${r.lawdCd}|${r.dong}|${r.aptName}`; const a = aggs.get(key) ?? { key, lawd: r.lawdCd, name: r.aptName, gu, dong: r.dong, prices: [], areas: [], by: r.buildYear ?? null }; a.prices.push(r.dealAmount); if (r.excluUseAr) a.areas.push(r.excluUseAr); a.by = r.buildYear ?? a.by; aggs.set(key, a); }
  const scored: any[] = [];
  for (const a of aggs.values()) {
    if (a.prices.length < rules.filters.minTrades180d) continue;
    a.prices.sort((x: number, y: number) => x - y); const med = median(a.prices); if (med > stretch) continue;
    const age = a.by ? nowYear - a.by : null; if (age == null || age > 10) continue; // 준신축만
    const tier = tierOf(a.dong); const inComf = med <= comfortable;
    const fresh = age <= 5 ? 12 : age <= 10 ? 9 : 6;
    const jArr = jMap.get(`${a.lawd}|${a.dong}|${nn(a.name)}`); let ratio = 0, jp = 0;
    if (jArr && jArr.length >= (rules.filters.rentMinSamples ?? 2)) { jArr.sort((x, y) => x - y); ratio = Math.round((median(jArr) / med) * 100); jp = ratio >= 85 ? 6 : ratio >= 75 ? 4 : ratio >= 65 ? 2 : 0; }
    const score = Math.round((tier * rules.weights.tierMultiplier + liquidity(a.prices.length, rules.weights.liquidityCap) + (inComf ? rules.weights.budgetFitComfortable : rules.weights.budgetFitStretch) + fresh + Math.min(rules.weights.regionHeatMax, regionHeat[a.gu] ?? 0) + jp) * 10) / 10;
    scored.push({ name: a.name, gu: a.gu, dong: a.dong, buildYear: a.by, age, minA: Math.round(Math.min(...a.areas)), maxA: Math.round(Math.max(...a.areas)), medianManwon: med, tradeCount: a.prices.length, jeonseRatioPct: ratio, score, inComfortable: inComf });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: any[] = []; const perGu: Record<string, number> = {};
  for (const r of scored) { if (out.length >= 14) break; if ((perGu[r.gu] ?? 0) >= 3) continue; perGu[r.gu] = (perGu[r.gu] ?? 0) + 1; out.push({ rank: out.length + 1, ...r }); }
  // 단지 프로필 링크용 complexNo 매칭(스윕 수집 단지에 있으면)
  const candsAll = await prisma.complexCandidate.findMany({ select: { complexNo: true, gu: true, dong: true, name: true } });
  const byKey = new Map<string, string>();
  for (const c of candsAll) byKey.set(`${c.gu}|${c.dong}|${nn(c.name)}`, c.complexNo);
  for (const r of out) {
    r.complexNo = byKey.get(`${r.gu}|${r.dong}|${nn(r.name)}`) ?? null;
    if (!r.complexNo) { // 부분 일치 폴백
      const hit = candsAll.find((c) => c.gu === r.gu && c.dong === r.dong && (nn(c.name).includes(nn(r.name)) || nn(r.name).includes(nn(c.name))));
      r.complexNo = hit?.complexNo ?? null;
    }
  }
  return { comfortable, stretch, shortlist: out };
}

async function harvestTracked(page: any, t: any, prisma: PrismaClient, fin: ReaderFinances, params: PolicyParams, model: InvestmentModel, regionHeat: Record<string, number>) {
  const since = new Date(Date.now() - 180 * 86_400_000);
  const trades = await prisma.aptTrade.findMany({ where: { lawdCd: t.lawd, dong: t.dong, dealDate: { gte: since } }, select: { aptName: true, excluUseAr: true, dealAmount: true, dealDate: true } });
  const mine = trades.filter((r) => r.aptName.includes(t.nameLike));
  const rentRows = await prisma.aptRent.findMany({ where: { lawdCd: t.lawd, dong: t.dong, dealDate: { gte: since }, monthlyRent: 0 }, select: { aptName: true, deposit: true } });
  const myRents = rentRows.filter((r) => r.aptName.includes(t.nameLike)).map((r) => r.deposit);
  const tb: Record<string, { p: number[]; latest: number; ms: number }> = {};
  for (const r of mine) { const b = bandOf(r.excluUseAr); tb[b] = tb[b] || { p: [], latest: 0, ms: 0 }; tb[b].p.push(r.dealAmount); if (r.dealDate.getTime() > tb[b].ms) { tb[b].ms = r.dealDate.getTime(); tb[b].latest = r.dealAmount; } }
  const tradeBands = Object.entries(tb).map(([band, v]) => ({ band, medianManwon: median(v.p), minManwon: Math.min(...v.p), maxManwon: Math.max(...v.p), latestManwon: v.latest, count: v.p.length })).sort((a, b) => a.medianManwon - b.medianManwon);

  let askBands: any[] = [], listings: any[] = [], totalListings = 0, dealListings = 0;
  try {
    const { articles, totalCount } = await harvestComplexArticles(page, t.complexNo);
    totalListings = totalCount ?? 0;
    const deals = articles.filter((a) => isDealType(repInfoOf(a)));
    dealListings = deals.length;
    const rows = deals.map((a) => { const r = repInfoOf(a) as any; const sp = r.spaceInfo || {}; const d = r.articleDetail || {}; const v = r.verificationInfo || {}; return { no: r.articleNumber ?? null, priceManwon: r.priceInfo?.dealPrice ? Math.round(r.priceInfo.dealPrice / 10_000) : null, exclu: sp.exclusiveSpace ?? null, type: sp.exclusiveSpaceName || '', dong: r.dongName || '', floor: d.floorInfo || '', dir: dirKo(d.direction), desc: d.articleFeatureDescription || '', verify: v.verificationType || '', confirm: v.articleConfirmDate || '' }; }).filter((x) => x.priceManwon);
    const ab: Record<string, number[]> = {};
    for (const r of rows) { const b = r.exclu ? bandOf(r.exclu) : '면적미상'; (ab[b] = ab[b] || []).push(r.priceManwon as number); }
    askBands = Object.entries(ab).map(([band, ps]) => ({ band, minManwon: Math.min(...ps), maxManwon: Math.max(...ps), medianManwon: median(ps), count: ps.length })).sort((a, b) => a.medianManwon - b.medianManwon);
    listings = rows.sort((a, b) => (a.exclu ?? 0) - (b.exclu ?? 0) || (a.priceManwon! - b.priceManwon!)).slice(0, 60);
  } catch (e) { /* 하베스트 실패 비치명 */ }

  // 자동 급매 판정: 최다 실거래 band 기준
  const mainT = [...tradeBands].sort((a, b) => b.count - a.count)[0];
  const mainA = mainT ? askBands.find((x) => x.band === mainT.band) : null;
  let verdict = '데이터 부족';
  if (mainT && mainA) {
    if (mainA.minManwon <= mainT.medianManwon) verdict = `${mainT.band} 최저호가 ${(mainA.minManwon / 10000).toFixed(1)}억 ≤ 실거래 중간 ${(mainT.medianManwon / 10000).toFixed(1)}억 — 저가 매물 존재(층·향 확인 필수)`;
    else if (mainA.minManwon > mainT.latestManwon * 1.05) verdict = `호가가 실거래 상회(최저 ${(mainA.minManwon / 10000).toFixed(1)}억 > 최근 ${(mainT.latestManwon / 10000).toFixed(1)}억) — 매도우위·고평가 진입 주의`;
    else verdict = `호가·실거래 정합(최저 ${(mainA.minManwon / 10000).toFixed(1)}억, 최근 실거래 ${(mainT.latestManwon / 10000).toFixed(1)}억)`;
  } else if (mainT) verdict = `실거래 중간 ${(mainT.medianManwon / 10000).toFixed(1)}억 · 호가 미확보`;

  const facts = (loadJson<Fact[]>('config/complex-facts.json') ?? []).find((f) => f.match.gu === t.gu && (!f.match.dong || f.match.dong === t.dong) && t.name.includes(f.match.nameIncludes));

  // 대표가(최다 실거래 band 중간) 기준 투자분석
  const jeonseRatioPct = myRents.length >= 2 && mainT ? Math.round((median(myRents) / mainT.medianManwon) * 100) : 65;
  const invest = mainT ? investCompact(mainT.medianManwon, jeonseRatioPct, mainT.count, fin, params, model, t.elapsed, t.household, regionApprPct(model, regionHeat[t.gu])) : null;

  return { ...t, jeonseRatioPct, reprPriceManwon: mainT?.medianManwon ?? null, invest, tradeBands, askBands, listings, totalListings, dealListings, verdict, facts: facts ? { station: facts.station, catalyst: facts.catalyst, school: facts.school, amenities: facts.amenities, living: facts.living, reasons: facts.reasons ?? [], cautions: facts.cautions ?? [], sources: facts.sources ?? [] } : null };
}

(async () => {
  const prisma = new PrismaClient();
  const rules: any = loadJson('config/recommendation-rules.json');
  const ctx: any = loadJson('config/market-context.json');
  const params = loadPolicyParams();
  const fin = loadReaderFinances();
  const model = loadInvestmentModel();
  if (!params || !fin || !model) throw new Error('config 로드 실패(policy/reader/investment)');
  const asOf = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const { comfortable, stretch, shortlist } = await buildShortlist(prisma, rules, ctx);
  const regionHeat: Record<string, number> = ctx?.regionHeat ?? {};
  // shortlist에 투자분석 부착(지역 상승률 반영)
  for (const s of shortlist as any[]) s.invest = investCompact(s.medianManwon, s.jeonseRatioPct || 65, s.tradeCount, fin, params, model, s.age, null, regionApprPct(model, regionHeat[s.gu]));

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', locale: 'ko-KR', viewport: { width: 1400, height: 900 } });
  await context.addInitScript(`()=>{Object.defineProperty(navigator,'webdriver',{get:()=>undefined});window.chrome=window.chrome||{runtime:{}};}`);
  const page = await context.newPage();
  await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const tracked: any[] = [];
  for (const t of TRACKED) { tracked.push(await harvestTracked(page, t, prisma, fin, params, model, regionHeat)); await page.waitForTimeout(3500); }
  await browser.close();

  const out = { asOf, generatedAt: new Date(Date.now() + 9 * 3_600_000).toISOString(), budget: { comfortable, stretch }, shortlist, tracked };
  writeFileSync(join(process.cwd(), 'config', 'matching-analysis.json'), JSON.stringify(out, null, 2));
  console.log(`matching-analysis.json 생성 · shortlist ${shortlist.length}건 · 추적 ${tracked.length}단지`);
  for (const t of tracked) console.log(`  · ${t.name}: 호가매물 ${t.dealListings}/${t.totalListings} · ${t.verdict}`);
  await prisma.$disconnect();
})();
