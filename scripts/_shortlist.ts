/**
 * _shortlist.ts — 실거주 최적지 shortlist (1회성 분석, 로테이션·일일한도 무시).
 * recommend-engine.ts의 스코어링을 그대로 재현하되:
 *   - 쿨다운/신저가 로테이션 제거(최선 후보 전수)
 *   - dailyLimit·maxPerGu 완화(top N, 구별 최대 GU_CAP)
 *   - 준신축(≤10년) 우선 뷰 + 예산구간 라벨
 * 실행: npx tsx scripts/_shortlist.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { tierOf, LAWD_GU } from '../src/lib/tiers';

const TOP_N = 18;
const GU_CAP = 3;

const median = (s: number[]) => s[Math.floor(s.length / 2)];
const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const normName = (s: string) => s.replace(/\s|아파트/g, '');
const loadJson = <T>(rel: string): T | null => {
  try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')) as T; } catch { return null; }
};

function liquidityScore(count: number, cap: number): number {
  let s: number;
  if (count >= 40) s = 16; else if (count >= 25) s = 13; else if (count >= 15) s = 11;
  else if (count >= 10) s = 9; else if (count >= 6) s = 6; else s = 4;
  return Math.min(cap, s);
}
function freshnessScore(bands: Array<{ maxAge: number; score: number }>, buildYear: number | null, nowYear: number) {
  if (buildYear == null) return 2;
  const age = nowYear - buildYear;
  for (const b of bands) if (age <= b.maxAge) return b.score;
  return 1;
}
function jeonseRatioScore(bands: Array<{ minPct: number; score: number }>, cap: number, pct: number) {
  for (const b of bands) if (pct >= b.minPct) return Math.min(cap, b.score);
  return 0;
}

(async () => {
  const prisma = new PrismaClient();
  const rules: any = loadJson('config/recommendation-rules.json');
  const ctx: any = loadJson('config/market-context.json');
  const comfortable = ctx?.budgetReality?.comfortableCeilingManwon ?? rules.budgetFallback.comfortableCeilingManwon;
  const stretch = ctx?.budgetReality?.stretchCeilingManwon ?? rules.budgetFallback.stretchCeilingManwon;
  const regionHeat: Record<string, number> = ctx?.regionHeat ?? {};
  const now = new Date();
  const nowYear = new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
  const since = new Date(now.getTime() - rules.filters.lookbackDays * 86_400_000);

  const rows = await prisma.aptTrade.findMany({
    where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, dealAmount: { lte: stretch } },
    select: { lawdCd: true, dong: true, aptName: true, dealAmount: true, excluUseAr: true, buildYear: true },
  });
  const aggs = new Map<string, any>();
  for (const r of rows) {
    const gu = LAWD_GU[r.lawdCd] ?? r.lawdCd;
    const key = `${r.lawdCd}|${r.dong}|${r.aptName}`;
    const a = aggs.get(key) ?? { key, lawdCd: r.lawdCd, name: r.aptName, gu, dong: r.dong, prices: [], areas: [], buildYear: r.buildYear ?? null };
    a.prices.push(r.dealAmount);
    if (r.excluUseAr) a.areas.push(r.excluUseAr);
    a.buildYear = r.buildYear ?? a.buildYear;
    aggs.set(key, a);
  }
  const rentRows = await prisma.aptRent.findMany({
    where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, monthlyRent: 0 },
    select: { lawdCd: true, dong: true, aptName: true, deposit: true },
  });
  const jeonseMap = new Map<string, number[]>();
  for (const r of rentRows) {
    const jk = `${r.lawdCd}|${r.dong}|${normName(r.aptName)}`;
    (jeonseMap.get(jk) ?? jeonseMap.set(jk, []).get(jk)!).push(r.deposit);
  }
  const rentMinSamples = rules.filters.rentMinSamples ?? 2;

  const scored: any[] = [];
  for (const a of aggs.values()) {
    if (a.prices.length < rules.filters.minTrades180d) continue;
    a.prices.sort((x: number, y: number) => x - y);
    const med = median(a.prices);
    if (med > stretch) continue;
    const tier = tierOf(a.dong);
    const tierPts = tier * rules.weights.tierMultiplier;
    const liq = liquidityScore(a.prices.length, rules.weights.liquidityCap);
    const inComfortable = med <= comfortable;
    const budgetPts = inComfortable ? rules.weights.budgetFitComfortable : rules.weights.budgetFitStretch;
    const fresh = freshnessScore(rules.freshnessByAge, a.buildYear, nowYear);
    const heat = Math.min(rules.weights.regionHeatMax, regionHeat[a.gu] ?? 0);
    const jArr = jeonseMap.get(`${a.lawdCd}|${a.dong}|${normName(a.name)}`);
    let ratioPct = 0, jPts = 0;
    if (jArr && jArr.length >= rentMinSamples) {
      jArr.sort((x, y) => x - y);
      ratioPct = Math.round((median(jArr) / med) * 100);
      jPts = jeonseRatioScore(rules.jeonseRatioByPct ?? [], rules.weights.jeonseRatioMax ?? 0, ratioPct);
    }
    const score = Math.round((tierPts + liq + budgetPts + fresh + heat + jPts) * 10) / 10;
    const age = a.buildYear ? nowYear - a.buildYear : null;
    const minA = a.areas.length ? Math.round(Math.min(...a.areas)) : 0;
    const maxA = a.areas.length ? Math.round(Math.max(...a.areas)) : 0;
    scored.push({ name: a.name, gu: a.gu, dong: a.dong, buildYear: a.buildYear, age, minA, maxA, med, n: a.prices.length, ratioPct, score, tier, inComfortable, heat });
  }
  scored.sort((a, b) => b.score - a.score);

  // 준신축(≤10년) 우선 top N (구별 GU_CAP), 그리고 전체 top N도 별도
  const pickWithCap = (list: any[], cap: number, n: number) => {
    const out: any[] = []; const perGu: Record<string, number> = {};
    for (const r of list) { if (out.length >= n) break; if ((perGu[r.gu] ?? 0) >= cap) continue; perGu[r.gu] = (perGu[r.gu] ?? 0) + 1; out.push(r); }
    return out;
  };
  const junsinchuk = scored.filter((r) => r.age != null && r.age <= 10);
  const shortlist = pickWithCap(junsinchuk, GU_CAP, TOP_N);

  const fmt = (r: any, i: number) =>
    `${String(i + 1).padStart(2)}. [${r.score.toFixed(1)}] ${r.name} (${r.gu} ${r.dong}) · ${r.buildYear ?? '?'}년(${r.age ?? '?'}년차) · 전용 ${r.minA}~${r.maxA}㎡ · 중간 ${eok(r.med)} · ${r.n}건 · 전세가율 ${r.ratioPct || '-'}% · ${r.inComfortable ? '자기자본권' : '2년적립권'}${r.heat >= 4 ? ' · 🔥열기상위' : ''}`;

  console.log(`\n===== 준신축(≤10년) 실거주 최적지 SHORTLIST (top ${TOP_N}, 구별≤${GU_CAP}) =====`);
  console.log(`기준일 ${new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)} · 스캔 단지 ${aggs.size} · 준신축 후보 ${junsinchuk.length} · 예산 comfortable ${eok(comfortable)}/stretch ${eok(stretch)}\n`);
  shortlist.forEach((r, i) => console.log(fmt(r, i)));

  // 구별 요약
  const byGu: Record<string, number> = {};
  for (const r of shortlist) byGu[r.gu] = (byGu[r.gu] ?? 0) + 1;
  console.log('\n--- shortlist 구별 분포 ---');
  Object.entries(byGu).sort((a, b) => b[1] - a[1]).forEach(([g, c]) => console.log(`  ${g}: ${c}`));

  // 참고: 준신축 아닌 전체 top 8(초유동성 구축 포함)
  console.log('\n===== [참고] 연식 무관 전체 top 8 =====');
  pickWithCap(scored, GU_CAP, 8).forEach((r, i) => console.log(fmt(r, i)));

  await prisma.$disconnect();
})();
