import Link from 'next/link';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cookies } from 'next/headers';
import InvestBreakdown, { type InvestBreakdownData } from '@/components/InvestBreakdown';
import MethodologyNote from '@/components/MethodologyNote';
import ProfileBadge from '@/components/ProfileBadge';
import { resolveContext, PROFILE_COOKIE } from '@/lib/profiles';
import { analyzeWithVersus, matchingCompact } from '@/lib/invest-compact';
import { RichText } from '@/components/RichText';

export const dynamic = 'force-dynamic';
export const metadata = { title: '매수 매칭 분석 | 뉴스 다이제스트' };

interface Versus { gStar: number; winner: string; a10: number; b10: number; rPct: number }
interface Invest {
  totalScore: number; equityIn: number; loan: number; ltvLoan: number; dsrLoanCap: number; remainingLoan: number; bindingCap: string;
  feasibleToday: boolean; feasible2yr: boolean; projected2yr: number; usableToday: number;
  monthlyPayment: number; holdingCost: number; interest2yr: number; acqTaxNet: number; propertyTax2yr: number;
  base: { apprPct: number; futureValue: number; gain: number; netProfit: number; roeAnnualPct: number }; conservative: number; optimistic: number;
  jeonseDeposit: number; loanCleared: boolean; cashReleased: number; interestReductionPct: number; wolseNetMonthly: number; breakevenApprPct: number; altVerdict: string;
  scores: { label: string; score: number; weight: number; formula: string; basis: string }[];
  vs?: Versus;
}
interface ShortItem {
  rank: number; name: string; gu: string; dong: string; buildYear: number | null; age: number | null;
  minA: number; maxA: number; medianManwon: number; tradeCount: number; jeonseRatioPct: number; score: number; inComfortable: boolean;
  complexNo?: string | null; // 단지 프로필 링크(스윕 수집 단지 매칭 시)
  invest?: Invest;
}
interface Band { band: string; medianManwon: number; minManwon?: number; maxManwon: number; latestManwon?: number; count: number }
interface Listing { no?: number | null; priceManwon: number; exclu: number | null; type: string; dong: string; floor: string; dir: string; desc: string; verify: string; confirm: string }
interface Facts { station?: string; catalyst?: string; school?: string; amenities?: string; living?: string; reasons: string[]; cautions: string[]; sources?: string[] }

/** 출처 문자열 → 링크 href (스킴 없으면 https:// 보정) */
const srcHref = (s: string) => (/^https?:\/\//.test(s) ? s : `https://${s}`);
const srcLabel = (s: string) => s.replace(/^https?:\/\//, '').split('/')[0];
interface Tracked {
  key: string; name: string; gu: string; dong: string; complexNo: string; stamp: string; elapsed?: number | null; household?: number | null;
  jeonseRatioPct?: number; reprPriceManwon?: number | null; invest?: Invest;
  tradeBands: Band[]; askBands: Band[]; listings: Listing[]; totalListings: number; dealListings: number; verdict: string; facts: Facts | null;
}

/** 커스텀 프로필: 저장된 프로필-독립 입력으로 invest 재계산 */
function recomputeInvest(price: number, jr: number, tradeCount: number, elapsed: number | null | undefined, household: number | null | undefined, apprBasePct: number, ctx: NonNullable<ReturnType<typeof resolveContext>>): Invest {
  const { a, vs } = analyzeWithVersus({ priceManwon: price, jeonseRatioPct: jr, tradeCount, elapsedYear: elapsed, household, apprBasePct }, ctx.fin, ctx.params, ctx.model);
  return { ...matchingCompact(a), vs } as unknown as Invest;
}

/** 추적단지 invest(대표가 기준) → InvestBreakdown 입력 정규화 */
function trackedBreakdown(t: Tracked): InvestBreakdownData {
  const iv = t.invest!;
  const tradeCount = t.tradeBands.reduce((s, b) => s + b.count, 0);
  return {
    priceManwon: t.reprPriceManwon ?? iv.equityIn + iv.loan, jeonseRatioPct: t.jeonseRatioPct ?? 65, jeonseEstimated: (t.jeonseRatioPct ?? 65) === 65,
    tradeCount, latestTradeDate: null, tradeMedian: t.reprPriceManwon ?? null, elapsedYear: t.elapsed ?? null, household: t.household ?? null,
    usableToday: iv.usableToday, projected2yr: iv.projected2yr, loanRatePct: 4.5,
    loan: iv.loan, equityIn: iv.equityIn, ltvLoan: iv.ltvLoan, dsrLoanCap: iv.dsrLoanCap, bindingCap: iv.bindingCap,
    feasibleToday: iv.feasibleToday, feasible2yr: iv.feasible2yr,
    monthlyPayment: iv.monthlyPayment, interest2yr: iv.interest2yr, acqTaxNet: iv.acqTaxNet, propertyTax2yr: iv.propertyTax2yr, holdingCost: iv.holdingCost, remainingLoan: iv.remainingLoan,
    base: iv.base, conservativeRoe: iv.conservative, optimisticRoe: iv.optimistic,
    jeonseDeposit: iv.jeonseDeposit, loanCleared: iv.loanCleared, cashReleased: iv.cashReleased, interestReductionPct: iv.interestReductionPct, wolseNetMonthly: iv.wolseNetMonthly,
    breakevenApprPct: iv.breakevenApprPct, altVerdict: iv.altVerdict,
    scores: iv.scores, totalScore: iv.totalScore,
  };
}
interface Matching {
  asOf: string; generatedAt: string; budget: { comfortable: number; stretch: number }; shortlist: ShortItem[]; tracked: Tracked[];
}

function loadMatching(): Matching | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'config', 'matching-analysis.json'), 'utf-8')) as Matching;
  } catch {
    return null;
  }
}

const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';

function verdictTone(v: string): { cls: string; label: string } {
  if (v.includes('저가') || v.includes('급매')) return { cls: 'bg-amber-100 text-amber-800 border-amber-300', label: '저가 매물' };
  if (v.includes('고평가') || v.includes('매도우위')) return { cls: 'bg-red-100 text-red-700 border-red-300', label: '매도우위' };
  if (v.includes('정합')) return { cls: 'bg-blue-100 text-blue-700 border-blue-300', label: '정합' };
  return { cls: 'bg-gray-100 text-gray-600 border-gray-300', label: '참고' };
}

function GroupTag({ gu }: { gu: string }) {
  const seoul = !gu.startsWith('안양') && !gu.startsWith('의왕');
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${seoul ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
      {seoul ? '서울' : '경기'}
    </span>
  );
}

export default async function MatchingPage() {
  const cookieStore = await cookies();
  const ctx = resolveContext(cookieStore.get(PROFILE_COOKIE)?.value);
  const data = loadMatching();

  if (!data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">매수 매칭 분석</h1>
        <p className="mt-4 text-gray-500">분석 데이터가 아직 없습니다. <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">npx tsx scripts/gen-matching.ts</code> 실행 후 표시됩니다.</p>
      </main>
    );
  }

  // 커스텀 프로필: shortlist·tracked invest 재계산(소량 — 즉시)
  if (ctx && !ctx.isDefault) {
    for (const s of data.shortlist) {
      if (s.invest) s.invest = recomputeInvest(s.medianManwon, s.jeonseRatioPct || 65, s.tradeCount, s.age, null, s.invest.base.apprPct, ctx);
    }
    for (const t of data.tracked) {
      if (t.invest && t.reprPriceManwon) t.invest = recomputeInvest(t.reprPriceManwon, t.jeonseRatioPct ?? 65, t.tradeBands.reduce((n, b) => n + b.count, 0), t.elapsed, t.household, t.invest.base.apprPct, ctx);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight">매수 매칭 분석</h1>
          <span className="font-mono text-xs text-gray-400">{data.asOf} 기준 · 실거래+네이버 호가 라이브</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
          준신축 후보를 실거래로 랭킹하고, 추적 3단지는 <b>호가 vs 실거래</b>로 급매를 진단합니다.
          <span className="mt-1 block text-xs text-gray-500">예산: 자기자본권 <b className="text-gray-700">{eok(data.budget.comfortable)}</b>(오늘) · <b className="text-gray-700">{eok(data.budget.stretch)}</b>(2년 적립)</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link href="/tracker" className="rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-blue-500 hover:text-blue-600">📋 재무 트래커</Link>
          <Link href="/recommend" className="rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-blue-500 hover:text-blue-600">🏠 오늘의 추천</Link>
          <Link href="/candidates" className="rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-blue-500 hover:text-blue-600">🔎 매물 후보</Link>
          <Link href="/listings" className="rounded-full border border-gray-300 px-3 py-1 text-gray-600 hover:border-blue-500 hover:text-blue-600">📈 전체 매물 투자분석</Link>
        </div>
      </header>

      <ProfileBadge />
      <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-[13px] leading-relaxed text-blue-900">
        🧭 점수는 <b>사전 조사·분석의 요약(참고자료)</b>이며 판단을 대신하지 않습니다 — 단지명을 클릭해 <b>프로필</b>에서 실거래·전세·통근·계산 근거를 직접 검증하세요.
      </p>
      <MethodologyNote current="/matching" />

      {/* ── 준신축 shortlist ── */}
      <section className="mb-8">
        <h2 className="mb-1 text-lg font-bold">준신축 실거주 최적지 <span className="text-sm font-normal text-gray-400">top {data.shortlist.length} · 투자우선 스코어</span></h2>
        <p className="mb-3 text-xs text-gray-500">홈그라운드(동작·관악) 준신축은 예산 2배+로 제외 — 예산 내 준신축은 경기 남부·서울 서남/동북권에 형성.</p>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2">#</th><th className="px-3 py-2">단지</th><th className="px-3 py-2">위치</th>
                <th className="px-3 py-2">연식</th><th className="px-3 py-2 text-right">실거래중간</th>
                <th className="px-3 py-2 text-right">거래</th><th className="px-3 py-2 text-right">전세가율</th>
                <th className="px-3 py-2 text-right">랭크</th>
                <th className="px-3 py-2 text-right">투자점수</th>
                <th className="px-3 py-2 text-right">ROE</th><th className="px-3 py-2">예산</th>
              </tr>
            </thead>
            <tbody>
              {data.shortlist.map((s) => (
                <tr key={s.rank} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-gray-400">{s.rank}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{s.complexNo ? <Link href={`/complex/${s.complexNo}`} className="hover:text-blue-600 hover:underline">{s.name} <span className="text-xs text-gray-400">📋</span></Link> : s.name}</td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1"><GroupTag gu={s.gu} /><span className="text-gray-600">{s.gu} {s.dong}</span></span></td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{s.buildYear ?? '?'}<span className="text-gray-400">({s.age}년)</span></td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eok(s.medianManwon)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-500">{s.tradeCount}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-500">{s.jeonseRatioPct || '-'}%</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-400">{s.score.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-blue-700">{s.invest?.totalScore ?? '-'}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${(s.invest?.base.roeAnnualPct ?? 0) >= 4 ? 'text-emerald-600' : (s.invest?.base.roeAnnualPct ?? 0) >= 0 ? 'text-gray-500' : 'text-red-500'}`}>{s.invest ? `${s.invest.base.roeAnnualPct}%` : '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${s.inComfortable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                      {s.inComfortable ? '자기자본권' : '2년적립'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 추적 3단지: 호가 vs 실거래 ── */}
      <section>
        <h2 className="mb-1 text-lg font-bold">추적 단지 · 호가 vs 실거래 급매 진단 <span className="text-sm font-normal text-gray-400">{data.tracked.length}곳 · 매일 자동 추적</span></h2>
        <p className="mb-4 text-xs text-gray-500">급매 = 실거래 중간 이하 호가. 최저 호가는 <b>층·향</b>에 좌우되니 개별 매물을 펼쳐 확인하세요.</p>

        <div className="space-y-5">
          {data.tracked.map((t) => {
            const tone = verdictTone(t.verdict);
            const bands = Array.from(new Set([...t.tradeBands.map((b) => b.band), ...t.askBands.map((b) => b.band)]));
            return (
              <article key={t.key} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-gray-900">{t.name}</h3>
                    <p className="text-xs text-gray-500">{t.gu} {t.dong} · {t.stamp} · 네이버 매물 {t.dealListings}/{t.totalListings}건 · <Link href={`/complex/${t.complexNo}`} className="font-medium text-blue-600 hover:underline">단지 프로필 →</Link></p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${tone.cls}`}>{tone.label}</span>
                </div>
                <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700"><RichText text={t.verdict} /></p>

                {/* 투자분석(대표가 기준) — 3단: ① 판단근거 → ② 추론과정 → ③ 점수산출 */}
                {t.invest && (
                  <details className="group mt-2 rounded-md border border-indigo-100 bg-indigo-50/40 px-3 py-2">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-indigo-800">
                      💹 투자분석(대표가 {t.reprPriceManwon ? eok(t.reprPriceManwon) : ''}·전세가율 {t.jeonseRatioPct}%) — 종합 <span className="font-mono text-sm">{t.invest.totalScore}</span> · ROE {t.invest.base.roeAnnualPct}%/년
                      <span className="ml-auto text-indigo-400 transition group-open:rotate-90">▸</span>
                    </summary>
                    <div className="mt-3">
                      <InvestBreakdown d={trackedBreakdown(t)} />
                      {t.invest.vs && (
                        <div className={`mt-2 rounded-md px-3 py-2 text-xs leading-relaxed ${t.invest.vs.winner === 'APT' ? 'bg-emerald-50 text-emerald-800' : 'bg-blue-50 text-blue-800'}`}>
                          <b>🏁 10년 장기 (집 vs S&amp;P500 ETF {t.invest.vs.rPct}%):</b> {t.invest.vs.winner === 'APT' ? '🏠 매수 우위' : '📈 ETF 우위'} —
                          10년 후 매수 <b>{eok(t.invest.vs.a10)}</b> vs ETF <b>{eok(t.invest.vs.b10)}</b> · 손익분기 <b>{t.invest.vs.gStar}%/년</b>
                          <span className="text-gray-400"> (상세 <Link href="/versus" className="underline">집vs주식</Link>)</span>
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {/* 밴드별 실거래 vs 호가 */}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[440px] text-xs">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-400">
                        <th className="py-1.5 pr-3">면적</th>
                        <th className="py-1.5 pr-3 text-right">실거래 중간(최근)</th>
                        <th className="py-1.5 pr-3 text-right">네이버 호가</th>
                        <th className="py-1.5 text-right">갭</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bands.map((b) => {
                        const tr = t.tradeBands.find((x) => x.band === b);
                        const ak = t.askBands.find((x) => x.band === b);
                        const gap = tr && ak ? ak.minManwon! - tr.medianManwon : null;
                        return (
                          <tr key={b} className="border-b last:border-0">
                            <td className="py-1.5 pr-3 font-medium text-gray-700">{b}</td>
                            <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-gray-600">{tr ? `${eok(tr.medianManwon)} (${eok(tr.latestManwon!)})` : '—'}</td>
                            <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-gray-900">{ak ? `${eok(ak.minManwon!)}~${eok(ak.maxManwon)}` : '—'}</td>
                            <td className={`py-1.5 text-right font-mono tabular-nums ${gap == null ? 'text-gray-300' : gap <= 0 ? 'text-amber-600' : 'text-gray-500'}`}>{gap == null ? '—' : (gap > 0 ? '+' : '') + eok(gap)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 개별 매물 */}
                {t.listings.length > 0 && (
                  <details className="mt-3 group">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-blue-700 hover:underline">
                      ▸ 개별 매물 {t.listings.length}건 펼치기 (가격·층·향·특징)
                    </summary>
                    <div className="mt-2 overflow-x-auto rounded-lg border border-gray-100">
                      <table className="w-full min-w-[600px] text-xs">
                        <thead>
                          <tr className="border-b bg-gray-50 text-left text-gray-400">
                            <th className="px-2 py-1.5 text-right">호가</th><th className="px-2 py-1.5">전용</th><th className="px-2 py-1.5">동/층</th>
                            <th className="px-2 py-1.5">향</th><th className="px-2 py-1.5">특징</th><th className="px-2 py-1.5">확인</th><th className="px-2 py-1.5">링크</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.listings.map((l, i) => (
                            <tr key={i} className="border-b last:border-0 align-top">
                              <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums text-gray-900">{eok(l.priceManwon)}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-600">{l.exclu ?? '?'}㎡<span className="text-gray-400">{l.type ? ` ${l.type}` : ''}</span></td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{l.dong ? `${l.dong}동 ` : ''}{l.floor}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{l.dir}</td>
                              <td className="px-2 py-1.5 text-gray-500">{l.desc || '—'}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap text-gray-400">{l.verify === 'OWNER' ? '소유자' : l.verify || ''}<br />{l.confirm}</td>
                              <td className="px-2 py-1.5 whitespace-nowrap"><a href={l.no ? `https://fin.land.naver.com/articles/${l.no}` : `https://fin.land.naver.com/complexes/${t.complexNo}?tab=article`} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{l.no ? '매물 ↗' : '단지 ↗'}</a></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                {/* 정성 요약 */}
                {t.facts && (
                  <div className="mt-3 grid gap-1.5 border-t border-gray-100 pt-3 text-xs text-gray-600 sm:grid-cols-2">
                    {t.facts.station && <div className="leading-relaxed">🚇 <RichText text={t.facts.station} /></div>}
                    {t.facts.catalyst && <div className="leading-relaxed">🚧 <RichText text={t.facts.catalyst} /></div>}
                    {t.facts.school && <div className="leading-relaxed">🏫 <RichText text={t.facts.school} /></div>}
                    {t.facts.living && <div className="leading-relaxed">🏢 <RichText text={t.facts.living} /></div>}
                    {t.facts.cautions?.length > 0 && (
                      <div className="sm:col-span-2 mt-1 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                        ⚠️ {t.facts.cautions.join(' · ')}
                      </div>
                    )}
                    {(t.facts.sources?.length ?? 0) > 0 && (
                      <div className="sm:col-span-2 mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                        📎 출처:
                        {t.facts.sources!.map((s, i) => (
                          <a key={i} href={srcHref(s)} target="_blank" rel="noreferrer" className="rounded border border-gray-200 px-1.5 py-0.5 text-blue-500 hover:border-blue-300 hover:underline">{srcLabel(s)}</a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <footer className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-400">
        생성 {new Date(data.generatedAt).toLocaleString('ko-KR')} · 재생성 <code className="rounded bg-gray-100 px-1 py-0.5">npx tsx scripts/gen-matching.ts</code> · 정성/타임라인 상세는 report/shortlist-timeline-2026-07-04.md · 임장 체크리스트 report/imjang-checklist.html
      </footer>
    </main>
  );
}
