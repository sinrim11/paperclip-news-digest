/**
 * gen-region-affordability.ts — 구별 예산 내 매수 가능 단지 목록 (2026-08-10 사용자 지시).
 *
 * "남양주 편중 완화 — 서울 전 지역으로 검토 확대, 각 지역마다 내 예산으로 구매 가능한 목록"
 * 수집권 전체(서울 25구 + 경기 4곳)의 최근 180일 실거래를 단지 단위로 집계해
 * 세 예산 밴드로 분류한다:
 *   ① 자기자본권  (≤ comfortable — market-context 일일 갱신)
 *   ② 스트레치    (comfortable < x ≤ stretch)
 *   ③ 부모님 찬스 (stretch < x ≤ stretch + 가족지원 — reader-profile)
 *
 * 산출:
 *   - config/region-affordability.json  (웹/후속 파이프라인 소비)
 *   - docs/region-affordability-<날짜>.md  (전체 목록 — 사람이 읽는 리포트)
 *   - stdout 텔레그램 요약 (daily-matching.sh가 발송)
 *
 * 실행: npx tsx scripts/gen-region-affordability.ts [--quiet]
 * 스케줄: daily-matching.sh (매일 08:45) 3단계 뒤에 편입.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { LAWD_GU } from '../src/lib/tiers';
import { regulationOf } from '../src/lib/region-regulation';

const prisma = new PrismaClient();

function loadJson<T>(rel: string): T | null {
  try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')) as T; } catch { return null; }
}
const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)];
const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const normName = (s: string) => s.replace(/\s|아파트/g, '');

type Band = '자기자본권' | '스트레치' | '부모님찬스';

interface Entry {
  name: string; dong: string; medianManwon: number; trades: number;
  buildYear: number | null; jeonseRatioPct: number | null; band: Band;
}

async function main() {
  const quiet = process.argv.includes('--quiet');
  const rules = loadJson<{ filters: { minExclusiveAreaM2: number; minTrades180d: number; lookbackDays: number; rentMinSamples?: number } }>('config/recommendation-rules.json');
  if (!rules) throw new Error('recommendation-rules.json 로드 실패');
  const ctx = loadJson<{ budgetReality?: { comfortableCeilingManwon?: number; stretchCeilingManwon?: number } }>('config/market-context.json');
  const comfortable = ctx?.budgetReality?.comfortableCeilingManwon ?? 70000;
  const stretch = ctx?.budgetReality?.stretchCeilingManwon ?? 78000;
  const parentSupport = Math.round(
    (loadJson<{ finances?: { contingencySupport?: { 가족지원?: number } } }>('config/reader-profile.json')?.finances?.contingencySupport?.가족지원 ?? 0) / 10_000,
  );
  const parentMax = stretch + parentSupport;
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

  const since = new Date(Date.now() - rules.filters.lookbackDays * 86_400_000);
  const [trades, rents] = await Promise.all([
    prisma.aptTrade.findMany({
      where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, dealAmount: { lte: parentMax } },
      select: { lawdCd: true, dong: true, aptName: true, dealAmount: true, buildYear: true },
    }),
    prisma.aptRent.findMany({
      where: { dealDate: { gte: since }, excluUseAr: { gte: rules.filters.minExclusiveAreaM2 }, monthlyRent: 0 },
      select: { lawdCd: true, dong: true, aptName: true, deposit: true },
    }),
  ]);

  const jeonseMap = new Map<string, number[]>();
  for (const r of rents) {
    const k = `${r.lawdCd}|${r.dong}|${normName(r.aptName)}`;
    (jeonseMap.get(k) ?? jeonseMap.set(k, []).get(k)!).push(r.deposit);
  }
  const rentMinSamples = rules.filters.rentMinSamples ?? 2;

  interface Agg { lawdCd: string; dong: string; name: string; prices: number[]; buildYear: number | null }
  const aggs = new Map<string, Agg>();
  for (const t of trades) {
    const k = `${t.lawdCd}|${t.dong}|${t.aptName}`;
    const a = aggs.get(k) ?? { lawdCd: t.lawdCd, dong: t.dong, name: t.aptName, prices: [], buildYear: t.buildYear ?? null };
    a.prices.push(t.dealAmount);
    a.buildYear = t.buildYear ?? a.buildYear;
    aggs.set(k, a);
  }

  const byGu = new Map<string, Entry[]>();
  for (const a of aggs.values()) {
    if (a.prices.length < rules.filters.minTrades180d) continue;
    a.prices.sort((x, y) => x - y);
    const med = median(a.prices);
    if (med > parentMax) continue;
    const band: Band = med <= comfortable ? '자기자본권' : med <= stretch ? '스트레치' : '부모님찬스';
    const gu = LAWD_GU[a.lawdCd] ?? a.lawdCd;
    const jArr = jeonseMap.get(`${a.lawdCd}|${a.dong}|${normName(a.name)}`);
    let jr: number | null = null;
    if (jArr && jArr.length >= rentMinSamples) {
      jArr.sort((x, y) => x - y);
      jr = Math.round((median(jArr) / med) * 100);
    }
    (byGu.get(gu) ?? byGu.set(gu, []).get(gu)!).push({
      name: a.name, dong: a.dong, medianManwon: med, trades: a.prices.length, buildYear: a.buildYear, jeonseRatioPct: jr, band,
    });
  }

  // 구별 정리 — 각 밴드 안에서 거래량(환금성) 내림차순
  const isSeoulGu = (gu: string) => Object.entries(LAWD_GU).some(([cd, name]) => name === gu && cd.startsWith('11'));
  const regions = [...byGu.entries()]
    .map(([gu, entries]) => {
      entries.sort((x, y) => y.trades - x.trades);
      const count = (b: Band) => entries.filter((e) => e.band === b).length;
      return {
        gu,
        isSeoul: isSeoulGu(gu),
        regulation: regulationOf(gu).label,
        counts: { 자기자본권: count('자기자본권'), 스트레치: count('스트레치'), 부모님찬스: count('부모님찬스'), total: entries.length },
        complexes: entries,
      };
    })
    .sort((x, y) => (Number(y.isSeoul) - Number(x.isSeoul)) || y.counts.total - x.counts.total);

  // ── 1. JSON 산출 ──
  writeFileSync(
    join(process.cwd(), 'config', 'region-affordability.json'),
    JSON.stringify({ _comment: 'gen-region-affordability 자동 생성 — 구별 예산 내 매수 가능 단지', asOf: today, budgets: { comfortable, stretch, parentSupport, parentMax }, regions }, null, 2) + '\n',
  );

  // ── 2. 마크다운 리포트 ──
  const bandMark: Record<Band, string> = { 자기자본권: '🟢', 스트레치: '🟡', 부모님찬스: '🟣' };
  const mdRegion = (r: (typeof regions)[number]) => {
    const rows = r.complexes.slice(0, 12).map((e) =>
      `| ${bandMark[e.band]} ${e.band} | ${e.dong} ${e.name} | ${eok(e.medianManwon)} | ${e.trades}건 | ${e.jeonseRatioPct != null ? e.jeonseRatioPct + '%' : '—'} | ${e.buildYear ?? '—'} |`).join('\n');
    return `### ${r.gu} — 총 ${r.counts.total}개 단지 (🟢 ${r.counts.자기자본권} · 🟡 ${r.counts.스트레치} · 🟣 ${r.counts.부모님찬스})\n\n` +
      `> 규제: ${r.regulation}\n\n| 밴드 | 단지 | 실거래 중간 | 180일 거래 | 전세가율 | 연식 |\n|---|---|---|---|---|---|\n${rows}\n` +
      (r.complexes.length > 12 ? `\n_( 외 ${r.complexes.length - 12}개 — config/region-affordability.json 참조 )_\n` : '');
  };
  const seoulRegions = regions.filter((r) => r.isSeoul);
  const gyeonggiRegions = regions.filter((r) => !r.isSeoul);
  const md = `# 구별 예산 내 매수 가능 단지 — ${today}

예산 기준 (매일 자동 갱신):
- 🟢 **자기자본권** ≤ ${eok(comfortable)} (오늘 매수 가능)
- 🟡 **스트레치** ≤ ${eok(stretch)} (2년 적립 도달권)
- 🟣 **부모님 찬스** ≤ ${eok(parentMax)} (가족 지원 최대 ${eok(parentSupport)} 전제 — 2026-08-10 지시)

전용 ${rules.filters.minExclusiveAreaM2}㎡+ · 최근 ${rules.filters.lookbackDays}일 실거래 ${rules.filters.minTrades180d}건+ 단지만 포함. 각 구 상위 12개(거래량순) 표기, 전체는 JSON 참조.

## 서울 (${seoulRegions.length}개 구 · ${seoulRegions.reduce((s, r) => s + r.counts.total, 0)}개 단지)

${seoulRegions.map(mdRegion).join('\n')}
## 경기 (${gyeonggiRegions.length}개 시·구 · ${gyeonggiRegions.reduce((s, r) => s + r.counts.total, 0)}개 단지)

${gyeonggiRegions.map(mdRegion).join('\n')}
---
생성: gen-region-affordability.ts (매일 08:45 daily-matching) · 데이터: 국토교통부 실거래가
`;
  const mdPath = join(process.cwd(), 'docs', `region-affordability-${today}.md`);
  writeFileSync(mdPath, md);

  // ── 3. 텔레그램 요약 (stdout — 호출측이 발송) — 2026-08-11 다이어트: 5줄, 상세는 /regions ──
  const totalAll = regions.reduce((s, r) => s + r.counts.total, 0);
  const topSeoul = [...seoulRegions].sort((x, y) => y.counts.자기자본권 - x.counts.자기자본권).slice(0, 3);
  const summary = [
    `🗺️ 구별 매수 가능 ${totalAll}단지 (🟢≤${eok(comfortable)} ${regions.reduce((s, r) => s + r.counts.자기자본권, 0)} · 🟡≤${eok(stretch)} ${regions.reduce((s, r) => s + r.counts.스트레치, 0)} · 🟣≤${eok(parentMax)} ${regions.reduce((s, r) => s + r.counts.부모님찬스, 0)})`,
    `서울 자기자본권 상위: ${topSeoul.map((r) => `${r.gu} ${r.counts.자기자본권}`).join(' · ')}`,
    `전체 목록·필터: 대시보드 /regions`,
  ].join('\n');
  if (!quiet) console.log(summary);
  console.error(`[affordability] ${regions.length}개 구·시 · ${totalAll}개 단지 → region-affordability.json + ${mdPath}`);
}

main()
  .catch((e) => { console.error('[affordability] fatal:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
