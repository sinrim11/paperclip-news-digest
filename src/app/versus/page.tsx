import Link from 'next/link';
import { cookies } from 'next/headers';
import { resolveContext, PROFILE_COOKIE } from '@/lib/profiles';
import { buildVersus } from '@/lib/versus-model';
import ProfileBadge from '@/components/ProfileBadge';

export const dynamic = 'force-dynamic';
export const metadata = { title: '아파트 vs 주식 · 장기 비교 | 뉴스 다이제스트' };

const eok = (m: number) => (m / 10000).toFixed(m % 10000 === 0 ? 0 : 1) + '억';

export default async function VersusPage({ searchParams }: { searchParams?: Promise<{ price?: string }> }) {
  const sp = (await searchParams) ?? {};
  const c = await cookies();
  const ctx = resolveContext(c.get(PROFILE_COOKIE)?.value);
  if (!ctx) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">아파트 vs 주식 · 장기 비교</h1>
        <p className="mt-4 text-gray-500">설정 로드 실패 — config/reader-profile.json·policy-params.json·investment-model.json을 확인하세요.</p>
      </main>
    );
  }
  // 프로필 기반 요청 시 계산(프리컴퓨트 없음 — 수 ms)
  const data = buildVersus(ctx.fin, ctx.params, ctx.model);
  const a = data.assumptions;
  const selPrice = Number(sp.price) || 68000;
  const pb = data.prices.find((p) => p.price === selPrice) ?? data.prices[1] ?? data.prices[0];
  const c8 = pb.crossovers.find((x) => x.r === 8) ?? pb.crossovers[Math.floor(pb.crossovers.length / 2)];
  const det = pb.detail.g3r8;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight">아파트 vs 주식 · {data.horizonYears}년 비교</h1>
          <span className="font-mono text-xs text-gray-400">실시간 계산 · 프로필 재무수치 기준</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
          아파트 매수와 <b>S&amp;P500 ETF 적립</b> 중 뭐가 이득인지 — 집값 상승률(g) × ETF 수익률(r) 조합별 <b>10년 후 순자산</b>으로 답합니다.
          <span className="mt-1 block text-xs text-gray-500">예측이 아닌 조건 지도: 어떤 조건이면 어느 쪽이 이기는지</span>
        </p>
      </header>

      <ProfileBadge />

      {/* ── 결론 요약 ── */}
      <section className="mb-6 rounded-xl border-2 border-gray-800 bg-gray-900 p-4 text-white">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">핵심 판정 (매매가 {eok(pb.price)} · S&amp;P500 지수 ETF 연 8% 가정, 배당 포함)</div>
        <div className="mt-2 space-y-1.5 text-sm leading-relaxed">
          <p>집값이 연 <b className="text-emerald-400">{c8.gA2}%</b> 이상 오르면 <b>매수가 승리</b> (전환 후 동급 전세 재진입 기준 · 저비용 주거 시 <b className="text-emerald-400">{c8.gA1}%</b>면 충분)</p>
          <p>집값이 그보다 덜 오르면(정체~1%대) <b>지수 ETF가 승리</b> — S&amp;P500 역사평균(연 10%)을 그대로 믿어도 경계는 {pb.crossovers.find((x) => x.r === 10)?.gA2 ?? '-'}%</p>
          <p className="text-xs text-gray-400">이유: 매수는 ①레버리지(자기자본 {eok(pb.equityIn)}로 {eok(pb.price)} 자산 보유) ②1주택 양도세 <b>비과세</b>(ETF는 차익 {a.stockCgtPct}%+배당 {a.divTaxPct}% 과세) ③2년마다 전세 인상분 현금 회수 ④ETF 경로는 전세보증금 {eok(a.jeonseDepositSelfManwon)}이 수익 0으로 묶임.</p>
        </div>
      </section>

      {/* 가격 선택 */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 font-semibold text-gray-400">매매가 가정</span>
        {data.prices.map((p) => (
          <Link key={p.price} href={`/versus?price=${p.price}`} className={`rounded-full border px-3 py-1 ${p.price === pb.price ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
            {eok(p.price)}{!p.feasibleToday ? ' (오늘불가)' : ''}
          </Link>
        ))}
        <span className="ml-2 text-gray-400">대출 {eok(pb.loan)}({pb.bindingCap}) · 자기자본 {eok(pb.equityIn)} · 월 원리금 {pb.monthlyPayment.toLocaleString()}만{!pb.feasibleToday ? ' · ⚠️ 자기자본 부족 — 적립 후 매수 필요' : ''}</span>
      </div>

      {/* ── ① 판단 근거 ── */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-base font-bold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] text-white">①</span> 판단 근거 <span className="text-xs font-normal text-gray-400">계산에 넣은 프로필 수치</span></h2>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {[
            ['가용 자기자본', `${eok(a.usableCapitalManwon)}`, '전세보증금 포함'],
            ['월 적립(매수펀드)', `${a.monthlySavingManwon}만`, '프로필 설정값'],
            ['전세가율 가정', `${a.jeonseRatioPct}%`, '실측 근사 고정값'],
            ['대출금리', `${a.loanRatePct}%`, '30년 원리금균등'],
            ['ETF 과세', `차익 ${a.stockCgtPct}%`, `배당 ${a.divYieldPct}%는 매년 ${a.divTaxPct}%`],
            ['아파트 양도세', '비과세', '1주택 2년거주·12억↓'],
            ['현 전세대출이자', `${a.jeonseLoanInterestM}만/월`, '매수 시 소멸'],
            ['매도비용', `${a.sellCostPct}%`, '중개보수 등'],
          ].map(([k, v, s]) => (
            <div key={k as string} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{k}</div>
              <div className="mt-0.5 font-mono text-[15px] font-bold tabular-nums text-gray-900">{v}</div>
              <div className="mt-1 text-xs leading-snug text-gray-500">{s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── ② 추론 과정 ── */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-base font-bold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] text-white">②</span> 추론 과정 <span className="text-xs font-normal text-gray-400">두 경로를 월 단위 120개월 시뮬레이션</span></h2>
        <div className="grid gap-3 text-[13px] sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 leading-relaxed">
            <div className="mb-1 font-bold text-emerald-800">🏠 경로 A — 매수</div>
            <ol className="list-decimal space-y-1 pl-4 text-gray-700">
              <li>오늘 매수: 자기자본 {eok(pb.equityIn)} + 대출 {eok(pb.loan)} + 취득세 {pb.acqTaxNet.toLocaleString()}만</li>
              <li>2년 실거주: 원리금 {pb.monthlyPayment.toLocaleString()}만/월 납부, 전세대출이자 {a.jeonseLoanInterestM}만/월 소멸, 잔여 저축은 ETF 풀에</li>
              <li>전세전환: 보증금(시세×{a.jeonseRatioPct}%)으로 대출 상환, 잉여 현금 → ETF 풀</li>
              <li>이후 2년마다 재계약: 전세 인상분 현금 회수(하락 시 역전세 반환 — 모델에 반영)</li>
              <li>거주 변형 <b>A1</b>=저비용 주거(본가 등, 주거비 0) / <b>A2</b>=동급 전세 재진입({eok(a.jeonseDepositSelfManwon)} 락업)</li>
              <li>10년 후 매도(비용 {a.sellCostPct}%)·보증금 반환·<b>양도세 비과세</b> + ETF 풀({a.stockCgtPct}% 과세)</li>
            </ol>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 leading-relaxed">
            <div className="mb-1 font-bold text-blue-800">📈 경로 B — S&amp;P500 지수 ETF</div>
            <ol className="list-decimal space-y-1 pl-4 text-gray-700">
              <li>현 전세 유지(보증금 {eok(a.jeonseDepositSelfManwon)} 락업 — 수익 0%)</li>
              <li>가용현금 {eok(a.usableCapitalManwon - a.jeonseDepositSelfManwon)} + 월 {a.monthlySavingManwon}만을 <b>S&amp;P500 지수 ETF</b>에 적립</li>
              <li>총수익 연 r%(배당 포함)로 월복리 — 배당 {a.divYieldPct}%는 매년 {a.divTaxPct}% 과세 후 재투자 (변동성·폭락 구간 미반영, 기대값 기준)</li>
              <li>10년 후 실현: 매매차익의 <b>{a.stockCgtPct}% 양도세</b> 차감(국내상장 ETF를 ISA·연금계좌에 담으면 절감 여지)</li>
            </ol>
            <div className="mt-2 rounded bg-white/70 px-2 py-1 text-xs text-gray-500">검증 예(g3%·r8%): A1 = 매도 {eok(det.A1.sale)} − 보증금 {eok(det.A1.depositLiab)} + 풀 {eok(det.A1.pool)} − ETF세 {det.A1.stockTax.toLocaleString()}만 = <b>{eok(det.A1.netWorth)}</b> / B = 풀 {eok(det.B.pool)} − 세 {det.B.stockTax.toLocaleString()}만 + 보증금 {eok(a.jeonseDepositSelfManwon)} = <b>{eok(det.B.netWorth)}</b></div>
          </div>
        </div>
      </section>

      {/* ── ③ 결과 그리드 ── */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-base font-bold"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-[11px] text-white">③</span> 결과 — 10년 후 순자산 <span className="text-xs font-normal text-gray-400">집값상승률(g) × S&amp;P500 총수익률(r) 전 조합</span></h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-3 py-2">집값 상승률 ↓</th>
                {pb.grid[0].cells.map((cell) => <th key={cell.r} className="px-3 py-2 text-center">ETF 연 {cell.r}%{cell.r === 8 ? ' (계획)' : cell.r === 10 ? ' (역사평균)' : ' (비관)'}</th>)}
              </tr>
            </thead>
            <tbody>
              {pb.grid.map((row) => (
                <tr key={row.g} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono font-semibold text-gray-700">연 {row.g}%</td>
                  {row.cells.map((cell) => {
                    const aptWins = cell.winner === 'APT';
                    const split = cell.winner === 'APT_A1';
                    return (
                      <td key={cell.r} className={`px-3 py-2 text-center ${aptWins ? 'bg-emerald-50' : split ? 'bg-amber-50' : 'bg-blue-50'}`}>
                        <div className={`font-bold ${aptWins ? 'text-emerald-700' : split ? 'text-amber-700' : 'text-blue-700'}`}>
                          {aptWins ? '🏠 매수' : split ? '조건부' : '📈 주식'}
                        </div>
                        <div className="mt-0.5 font-mono text-xs tabular-nums text-gray-500">
                          매수 {eok(cell.A1)}<span className="text-gray-300">(저비용)</span>·{eok(cell.A2)}<span className="text-gray-300">(전세)</span><br />ETF {eok(cell.B)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">🏠 매수 = 두 거주 변형 모두 승리 · <span className="text-amber-700">조건부</span> = 저비용 주거(A1) 시에만 매수 승리 · 📈 주식 = 매수 열위. 손익분기: ETF 6%면 g*={pb.crossovers[0].gA2}%, 8%면 {c8.gA2}%, 10%면 {pb.crossovers[2].gA2}% (동급 전세 기준).</p>
      </section>

      {/* 연도별 궤적 */}
      <section className="mb-6">
        <h3 className="mb-2 text-sm font-bold text-gray-700">연도별 순자산 궤적 <span className="text-xs font-normal text-gray-400">(ETF 8% 고정 · 세전)</span></h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-gray-500">
                <th className="px-2 py-1.5 text-left">연차</th>
                {pb.series.years.map((y) => <th key={y} className="px-2 py-1.5 text-right font-mono">{y}년</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="px-2 py-1.5 font-semibold text-emerald-700">매수(집 3%↑)</td>
                {pb.series.A1g3.map((v, i) => <td key={i} className="px-2 py-1.5 text-right font-mono tabular-nums">{(v / 10000).toFixed(1)}</td>)}
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5 font-semibold text-emerald-800">매수(집 4%↑)</td>
                {pb.series.A1g4.map((v, i) => <td key={i} className="px-2 py-1.5 text-right font-mono tabular-nums">{(v / 10000).toFixed(1)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-1.5 font-semibold text-blue-700">ETF(연 8%)</td>
                {pb.series.B.map((v, i) => <td key={i} className="px-2 py-1.5 text-right font-mono tabular-nums">{(v / 10000).toFixed(1)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">단위: 억원. 매수 경로는 초기 2년(취득세+이자 선부담) 동안 ETF에 뒤지다가 전세전환 이후 역전하는 구조 — 2년 모델에서 ROE가 음수였던 이유가 여기 있음.</p>
      </section>

      {/* 정직한 한계 */}
      <section className="mb-6 rounded-lg border border-red-200 bg-red-50/50 p-3 text-xs leading-relaxed text-gray-700">
        <div className="mb-1 font-bold text-red-800">⚠️ 이 비교가 말해주지 않는 것 (정직한 한계)</div>
        <ul className="list-disc space-y-1 pl-4">
          <li><b>예측이 아님</b> — 서울/수도권 아파트 장기 명목상승률은 시기별 0~7%로 편차가 큼. S&amp;P500 역사평균 10%도 과거 실적이지 보장이 아님(향후 10년 기대치는 밸류에이션상 더 낮게 보는 견해 다수 → 8%를 계획치로 사용).</li>
          <li><b>이 계산의 주식 경로는 지수 ETF 기준</b> — 개별주·테마 집중 포트폴리오는 지수보다 변동성이 훨씬 크므로, 이 비교가 성립하려면 실제로 S&amp;P500류 지수 ETF로 운용해야 함.</li>
          <li><b>리스크 비대칭</b> — 매수는 레버리지라 하락 시 손실도 배속(집 −10% ≈ 자기자본 −33%). 역전세 시 보증금 반환 현금 필요(모델은 반영하나 유동성 압박은 별개). ETF는 반토막도 가능하나 강제청산 없음.</li>
          <li><b>유동성</b> — 집은 팔리는 데 수개월, ETF는 즉시. 급전 필요 상황에 취약한 건 매수 쪽.</li>
          <li><b>A1(저비용 주거) 변형은 전환 후 8년간 본가 등 무비용 거주 가정</b> — 현실성은 본인 판단. 동급 전세 재진입(A2)이 보수적 기본값.</li>
          <li><b>둘 다 하는 절충</b>이 실제 최적일 수 있음 — 매수 후에도 월 적립은 계속 ETF로 들어가는 구조(모델에 이미 반영됨).</li>
        </ul>
      </section>

      <footer className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-400">
        요청 시 실시간 계산(프로필: <Link href="/settings" className="text-blue-500 hover:underline">설정</Link>) · 모델 src/lib/versus-model.ts · 2년 단기 분석은 <Link href="/listings" className="text-blue-500 hover:underline">전체 매물</Link>·<Link href="/matching" className="text-blue-500 hover:underline">매수 분석</Link> · 재무 전제는 <Link href="/tracker" className="text-blue-500 hover:underline">재무 트래커</Link>
      </footer>
    </main>
  );
}
