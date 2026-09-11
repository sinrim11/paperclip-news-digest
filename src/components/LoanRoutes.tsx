/**
 * LoanRoutes — 구매자 유형별 자금계획 (2026-09-12 개편).
 *
 * 종전엔 '생애최초 무주택' 하나만 계산해 보여줬다. 그런데 LTV가 70%냐 40%냐로 필요 현금이
 * 억 단위로 갈린다 — 4.5억 매물에서 생애최초 1.35억 vs 일반 무주택 2.7억, 10.5억에서는
 * 4.5억 vs 6.3억이다. 생애최초가 아닌 사람은 자기 조건과 전혀 다른 숫자를 보고 있었다.
 *
 * 토글로 고르게 하지 않고 유형을 한 번에 나열한다. 초보는 자기가 어느 유형인지도 모르는
 * 경우가 많고, 나란히 놓으면 "생애최초 여부가 이만큼 차이를 만든다"는 것 자체가 정보가 된다.
 */

import { loanRoutes, buyerTypes, DEFAULT_BUYER_TYPE } from '@/lib/policy-loans';

const eok = (m: number) => {
  const v = m / 10000;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '억';
};

export function LoanRoutes({ priceManwon }: { priceManwon: number }) {
  const rows = buyerTypes().map((b) => {
    const r = loanRoutes(priceManwon, b.id);
    const best = r.policy ?? r.bank; // 정책이 되면 정책, 아니면 은행
    return { b, r, best };
  });
  if (!rows.length || !rows[0].best) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-indigo-100 bg-indigo-50/40">
      <div className="flex flex-wrap items-baseline gap-x-2 px-3 pt-2">
        <span className="text-xs font-semibold text-gray-500">구매자 유형별 자금계획</span>
        <span className="text-xs text-gray-400">최저 호가 {eok(priceManwon)} 기준 · 유형에 따라 필요 현금이 크게 갈립니다</span>
      </div>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th scope="col" className="py-1 pl-3 pr-2 font-medium">유형</th>
              <th scope="col" className="px-2 text-right font-medium">대출</th>
              <th scope="col" className="px-2 text-right font-medium">필요 현금</th>
              <th scope="col" className="px-2 text-right font-medium">월 상환</th>
              <th scope="col" className="py-1 pl-2 pr-3 font-medium">경로</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-100/70">
            {rows.map(({ b, r, best }) => {
              const isDefault = b.id === DEFAULT_BUYER_TYPE;
              return (
                <tr key={b.id} className={isDefault ? 'bg-white/70' : undefined}>
                  <td className="py-1.5 pl-3 pr-2">
                    <span className={isDefault ? 'font-semibold text-indigo-800' : 'text-gray-700'}>{b.label}</span>
                    <span className="ml-1 text-xs text-gray-400">LTV {Math.round(b.ltv * 100)}%</span>
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums text-gray-900">{best ? eok(best.loan) : '—'}</td>
                  <td className="px-2 text-right font-mono font-semibold tabular-nums text-indigo-700">{best ? eok(best.cash) : '—'}</td>
                  <td className="px-2 text-right font-mono tabular-nums text-gray-900">{best ? `${best.monthly}만` : '—'}</td>
                  <td className="py-1.5 pl-2 pr-3 text-xs text-gray-500">
                    {r.policy ? (
                      <span className="text-emerald-700">{r.policy.label} {r.policy.rateText}</span>
                    ) : (
                      <span>
                        시중은행 4.5%
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
        30년 원리금균등 · 취득세·중개보수 별도 · 실행 전 DSR 한도 확인 필요.
        1주택 갈아타기는 기존 주택 처분조건부로 실행되며 기한 미이행 시 대출이 회수됩니다.
      </p>
    </div>
  );
}
