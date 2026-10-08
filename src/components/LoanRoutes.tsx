/**
 * LoanRoutes — 구매자 유형별 자금계획 + 총 월 실부담 (2026-09-12).
 *
 * 두 번의 개편이 겹쳐 있다.
 * ① 유형 축: 생애최초 하나로만 계산하던 걸 5개 유형으로 갈랐다. LTV 70%냐 40%냐로 필요
 *    현금이 억 단위로 갈린다(4.5억 매물에서 1.35억 vs 2.7억).
 * ② 월 부담: 종전 '월 상환'은 대출 원리금만이었다. 실제로는 관리비(세대당 중앙값 12.2만원)와
 *    재산세가 더 붙는다. 원리금만 보여주는 건 정보 부족이 아니라 과소 표시를 조장하는 쪽이다.
 *
 * 별도 블록을 새로 만들지 않고 기존 표의 '월 상환' 칸을 '월 부담'으로 확장했다 — 상세 카드가
 * 이미 세로로 길고, 같은 성격의 숫자를 두 군데 나눠 놓으면 읽는 사람이 합산을 해야 한다.
 */

import { loanRoutes, buyerTypes, DEFAULT_BUYER_TYPE } from '@/lib/policy-loans';
import { kaptOf, monthlyBreakdown, type KaptRecord } from '@/lib/monthly-cost';

const eok = (m: number) => {
  const v = m / 10000;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '억';
};
const manwon = (won: number) => Math.round(won / 10_000).toLocaleString();

export function LoanRoutes({
  priceManwon,
  complexNo,
  publicPriceWon,
}: {
  priceManwon: number;
  complexNo?: string;
  publicPriceWon?: number | null;
}) {
  const kapt: KaptRecord | null = complexNo ? kaptOf(complexNo) : null;
  const rows = buyerTypes().map((b) => {
    const r = loanRoutes(priceManwon, b.id);
    const best = r.policy ?? r.bank;
    const cost = best ? monthlyBreakdown(best.monthly, kapt, publicPriceWon ?? null) : null;
    return { b, r, best, cost };
  });
  if (!rows.length || !rows[0].best) return null;

  const sample = rows[0].cost;
  const hasExtra = sample && (sample.feeWon || sample.taxWon);

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-indigo-100 bg-indigo-50/40">
      <div className="flex flex-wrap items-baseline gap-x-2 px-3 pt-2">
        <span className="text-xs font-semibold text-gray-500">구매자 유형별 자금계획</span>
        <span className="text-xs text-gray-400">최저 호가 {eok(priceManwon)} 기준 · 유형에 따라 필요 현금이 크게 갈립니다</span>
      </div>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th scope="col" className="py-1 pl-3 pr-2 font-medium">유형</th>
              <th scope="col" className="px-2 text-right font-medium">대출</th>
              <th scope="col" className="px-2 text-right font-medium">필요 현금</th>
              <th scope="col" className="px-2 text-right font-medium">{hasExtra ? '월 부담' : '월 상환'}</th>
              <th scope="col" className="py-1 pl-2 pr-3 font-medium">경로</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-100/70">
            {rows.map(({ b, r, best, cost }) => {
              const isDefault = b.id === DEFAULT_BUYER_TYPE;
              return (
                <tr key={b.id} className={isDefault ? 'bg-white/70' : undefined}>
                  <td className="py-1.5 pl-3 pr-2">
                    <span className={isDefault ? 'font-semibold text-indigo-800' : 'text-gray-700'}>{b.label}</span>
                    <span className="ml-1 text-xs text-gray-400">LTV {Math.round(b.ltv * 100)}%</span>
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums text-gray-900">{best ? eok(best.loan) : '—'}</td>
                  <td className="px-2 text-right font-mono font-semibold tabular-nums text-indigo-700">{best ? eok(best.cash) : '—'}</td>
                  <td className="px-2 text-right font-mono tabular-nums">
                    {cost ? (
                      <>
                        <span className="font-semibold text-gray-900">{manwon(cost.totalWon)}만</span>
                        {hasExtra && (
                          <span className="block text-[11px] font-normal text-gray-400">원리금 {cost.loan}만</span>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-1.5 pl-2 pr-3 text-xs text-gray-500">
                    {r.policy ? (
                      <span className="text-emerald-700">{r.policy.label} {r.policy.rateText}</span>
                    ) : (
                      <span>
                        시중은행 {r.bank?.rateText ?? '—'}
                        {r.policyBlockedBy && <span className="text-gray-400"> · 정책대출 {r.policyBlockedBy}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 pb-2 pt-1.5 text-[11px] leading-relaxed text-gray-400">
        {hasExtra ? (
          <>
            <b className="text-gray-500">월 부담</b> = 원리금 + 관리비
            {sample?.feeWon ? ` ${manwon(sample.feeWon)}만` : ''}
            {sample?.taxWon ? ` + 재산세 ${manwon(sample.taxWon)}만` : ''}
            {sample?.missing.length ? ` (${sample.missing.join('·')} 미포함)` : ''}
            {' · '}관리비는 K-apt 개별사용료·장기수선충당금 세대당 환산이며 공용관리비는 빠져 실제 고지서는 이보다 큽니다.
            {' '}
          </>
        ) : null}
        30년 원리금균등 · 취득세·중개보수 별도 · 실행 전 DSR 한도 확인 필요.
        1주택 갈아타기는 기존 주택 처분조건부로 실행되며 기한 미이행 시 대출이 회수됩니다.
      </p>
    </div>
  );
}
