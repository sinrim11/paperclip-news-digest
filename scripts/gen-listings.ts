/**
 * gen-listings.ts — 네이버 수집 전체 매물(ComplexCandidate.listings)을 투자분석으로 강화 → config/listings-analysis.json
 *   각 매물마다: 전세가율(AptRent 조인)·최근 실거래일/건수(AptTrade 조인)·매수→2년거주→전세전환 ROE·영역별 점수(근거).
 * 페이지 src/app/listings/page.tsx가 이 JSON을 읽어 렌더.
 * 실행: npx tsx scripts/gen-listings.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { LAWD_GU } from '../src/lib/tiers';
import { loadPolicyParams, loadReaderFinances } from '../src/lib/tracker';
import { loadInvestmentModel, regionApprPct } from '../src/lib/investment-model';
import { analyzeWithVersus, listingsCompact } from '../src/lib/invest-compact';
import { computeCommute, computeAmenity, computeAmenityKakao, lineLabel, DEFAULT_WORK, type KakaoCtx } from '../src/lib/commute';

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const normName = (s: string) => s.replace(/\s|아파트|아파트$/g, '');
const FALLBACK_JEONSE = 65;

(async () => {
  const prisma = new PrismaClient();
  const params = loadPolicyParams();
  const fin = loadReaderFinances();
  const model = loadInvestmentModel();
  if (!params || !fin || !model) throw new Error('config 로드 실패(policy/reader/investment)');

  const guToLawd: Record<string, string> = {};
  for (const [lawd, gu] of Object.entries(LAWD_GU)) if (!guToLawd[gu]) guToLawd[gu] = lawd;
  let regionHeat: Record<string, number> = {};
  try { regionHeat = (JSON.parse(readFileSync('config/market-context.json', 'utf-8')).regionHeat) ?? {}; } catch { /* 기본값 사용 */ }

  const since = new Date(Date.now() - 180 * 86_400_000);
  const [cands, trades, rents] = await Promise.all([
    prisma.complexCandidate.findMany({ where: { inBudgetCount: { gt: 0 } } }),
    prisma.aptTrade.findMany({ where: { dealDate: { gte: since } }, select: { lawdCd: true, dong: true, aptName: true, dealAmount: true, dealDate: true } }),
    prisma.aptRent.findMany({ where: { dealDate: { gte: since }, monthlyRent: 0 }, select: { lawdCd: true, dong: true, aptName: true, deposit: true } }),
  ]);

  // 실거래/전세 집계 (lawd|dong 버킷 안에서 정규화 이름 매칭)
  type TAgg = { prices: number[]; latestMs: number };
  const tByCell = new Map<string, { name: string; agg: TAgg }[]>();
  for (const r of trades) {
    const cell = `${r.lawdCd}|${r.dong}`; const arr = tByCell.get(cell) ?? []; const nm = normName(r.aptName);
    let e = arr.find((x) => x.name === nm); if (!e) { e = { name: nm, agg: { prices: [], latestMs: 0 } }; arr.push(e); }
    e.agg.prices.push(r.dealAmount); const ms = r.dealDate.getTime(); if (ms > e.agg.latestMs) e.agg.latestMs = ms;
    tByCell.set(cell, arr);
  }
  const rByCell = new Map<string, { name: string; deposits: number[] }[]>();
  for (const r of rents) {
    const cell = `${r.lawdCd}|${r.dong}`; const arr = rByCell.get(cell) ?? []; const nm = normName(r.aptName);
    let e = arr.find((x) => x.name === nm); if (!e) { e = { name: nm, deposits: [] }; arr.push(e); }
    e.deposits.push(r.deposit); rByCell.set(cell, arr);
  }
  const matchName = (arr: { name: string }[] | undefined, target: string) =>
    arr?.find((x) => x.name === target || x.name.includes(target) || target.includes(x.name));

  // 통근·상권: 출근지/목적(소유자 프로필) + 동별 세대밀도 + 카카오 실데이터(있으면 근사 대체)
  const work = fin.work ?? DEFAULT_WORK;
  const purposeLive = fin.purpose === 'live';
  const dongHH = new Map<string, number>();
  for (const c of cands) dongHH.set(`${c.gu}|${c.dong}`, (dongHH.get(`${c.gu}|${c.dong}`) ?? 0) + c.household);
  let kakaoCtx: { workKey: string; complexes: Record<string, KakaoCtx> } | null = null;
  try {
    const kc = JSON.parse(readFileSync('config/kakao-context.json', 'utf-8'));
    const wk = `${work.lat.toFixed(5)},${work.lng.toFixed(5)}`;
    kakaoCtx = kc;
    if (kc.workKey !== wk) { // 출근지 불일치 → 자차 실경로 무효(역·상권은 유효)
      for (const e of Object.values(kc.complexes) as any[]) { e.driveMin = null; e.driveKm = null; }
      console.log('kakao-context 출근지 불일치 — 자차 실경로 제외(역·상권만 사용)');
    }
  } catch { console.log('kakao-context 없음 — 좌표 근사 모델 사용'); }

  const out: any[] = [];
  for (const c of cands) {
    const lawd = guToLawd[c.gu]; if (!lawd) continue;
    const cell = `${lawd}|${c.dong}`; const nm = normName(c.name);
    const t = matchName(tByCell.get(cell), nm) as any;
    const rr = matchName(rByCell.get(cell), nm) as any;
    const tradeMedian = t?.agg.prices.length ? median(t.agg.prices) : null;
    const tradeCount = t?.agg.prices.length ?? 0;
    const latestTradeDate = t?.agg.latestMs ? new Date(t.agg.latestMs).toISOString().slice(0, 10) : null;
    const jeonseMed = rr?.deposits.length >= 2 ? median(rr.deposits) : null;
    const jeonseRatioPct = jeonseMed && tradeMedian ? Math.round((jeonseMed / tradeMedian) * 100) : FALLBACK_JEONSE;
    const jeonseEstimated = !(jeonseMed && tradeMedian);

    // 단지 좌표 기반 통근·상권(단지당 1회 계산 — 매물들이 공유). 카카오 실데이터 있으면 우선.
    const kc = kakaoCtx?.complexes[c.complexNo] ?? null;
    const cm = c.lat != null && c.lng != null ? computeCommute(c.lat, c.lng, work, kc) : null;
    const am = c.lat != null && c.lng != null
      ? (kc?.counts ? computeAmenityKakao(kc.counts, kc.subway?.distanceM ?? null, c.lat, c.lng, fin.lifestyle ?? 'single') : computeAmenity(c.lat, c.lng, dongHH.get(`${c.gu}|${c.dong}`) ?? c.household))
      : null;

    const listings = Array.isArray(c.listings) ? (c.listings as any[]) : [];
    for (const L of listings) {
      const price = L.price;
      if (!price || price <= 0) continue;
      const { a, vs } = analyzeWithVersus({
        priceManwon: price, jeonseRatioPct, tradeCount, exclusiveArea: L.exclusiveArea, elapsedYear: c.elapsedYear, household: c.household,
        apprBasePct: regionApprPct(model, regionHeat[c.gu]),
        purposeLive, commute: cm ? { score: cm.score, formula: cm.formula, basis: cm.basis } : null, amenity: am ? { score: am.score, formula: am.formula, basis: am.basis } : null,
      }, fin, params, model);
      out.push({
        complexNo: c.complexNo, complexName: c.name, gu: c.gu, dong: c.dong, household: c.household, elapsedYear: c.elapsedYear,
        lat: c.lat, lng: c.lng, dongHH: dongHH.get(`${c.gu}|${c.dong}`) ?? c.household,
        price, area: L.exclusiveArea ?? null, floor: L.floor ?? null, unitDong: L.dong ?? null,
        articleNo: L.articleNo ?? null, // 네이버 매물 딥링크(주간 sweep부터 수집)
        listedDate: L.confirmDate ?? null, dir: L.direction ? String(L.direction).split('').map((c: string) => (({ E: '동', W: '서', S: '남', N: '북' } as any)[c] ?? c)).join('') : null,
        jeonseRatioPct, jeonseEstimated, tradeMedian, tradeCount, latestTradeDate, sweptAt: c.sweptAt.toISOString().slice(0, 10),
        cm: cm ? { station: cm.origin.name, lines: cm.origin.lines.map(lineLabel).join('·'), walkMin: cm.origin.walkMin, transfers: cm.transfers, totalMin: cm.totalMin, driveMin: cm.driveMin, driveReal: cm.driveReal, straightKm: cm.straightKm, busDependent: cm.busDependent, score: cm.score, workLabel: cm.workLabel } : null,
        am: am ? { score: am.score, stationsIn1km: am.stationsIn1km, nearestWalkMin: am.nearestWalkMin } : null,
        a: listingsCompact(a),
        vs, // 10년 집vs주식 요약(S&P500 ETF r=8%·보수 A2 변형): winner·gStar·a10·b10
      });
    }
  }
  out.sort((x, y) => y.a.totalScore - x.a.totalScore);

  const result = {
    asOf: new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10),
    generatedAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
    budget: { comfortable: 70000, stretch: 78000 },
    model: { loanRatePct: model.loanRatePct, baseApprPct: model.appreciationScenariosPct[model.baseScenario], holdYears: model.holdYears, altReturnsPct: model.altReturnsPct },
    work: { label: work.label, purposeLive },
    count: out.length,
    listings: out,
  };
  writeFileSync('config/listings-analysis.json', JSON.stringify(result, null, 0));
  console.log(`listings-analysis.json 생성 · 매물 ${out.length}건 · 단지 ${cands.length}`);
  console.log('상위 5:', out.slice(0, 5).map((x) => `${x.complexName}(${x.gu}) ${(x.price / 10000).toFixed(1)}억 점수${x.a.totalScore}`).join(' / '));
  console.log('전세가율 실측/추정:', out.filter((x) => !x.jeonseEstimated).length, '/', out.filter((x) => x.jeonseEstimated).length);
  await prisma.$disconnect();
})();
