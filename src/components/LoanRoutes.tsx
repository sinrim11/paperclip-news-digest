/**
 * LoanRoutes — 무주택 자금계획 두 경로 (2026-08-29).
 *
 * 카드뉴스에만 있던 '디딤돌 vs 시중은행' 비교를 웹 상세 카드로 옮긴다.
 * 한쪽만 보여주면 오해가 생긴다: 디딤돌은 금리가 낮은 대신 한도가 2.4억이라
 * 은행보다 필요 현금이 오히려 커지는 구간이 있다. 둘을 나란히 놓아야 고를 수 있다.
 */

import { loanRoutes, type LoanPath } from '@/lib/policy-loans';

const eok = (m: number) => {
  const v = m / 10000;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '억';
};

function Route({ p, tone }: { p: LoanPath; tone: 'policy' | 'bank' }) {
  const accent = tone === 'policy' ? 'text-indigo-700' : 'text-gray-700';
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={`text-[13px] font-semibold ${accent}`}>{p.label}</span>
      <span className="text-xs text-gray-400">{p.rateText}</span>
      <span className="text-[13px] text-gray-600">
        대출 <b className="font-mono text-gray-900">{eok(p.loan)}</b>
        {' · '}현금 <b className="font-mono text-gray-900">{eok(p.cash)}</b>
        {' · '}월 <b className="font-mono text-gray-900">{p.monthly}만</b>
      </span>
    </div>
  );
}

export function LoanRoutes({ priceManwon }: { priceManwon: number }) {
  const { policy, policyBlockedBy, bank } = loanRoutes(priceManwon);
  if (!policy && !bank) return null;

  return (
    <div className="mt-2 rounded-md border border-indigo-100 bg-indigo-50/40 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-semibold text-gray-500">무주택 자금계획</span>
        {policy && <span className="text-xs text-gray-400">{policy.eligibility} 충족 시</span>}
      </div>
      <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-4">
        {policy ? (
          <Route p={policy} tone="policy" />
        ) : (
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-[13px] font-semibold text-gray-400 line-through">디딤돌</span>
            <span className="text-xs text-red-600">{policyBlockedBy}</span>
          </div>
        )}
        {bank && <Route p={bank} tone="bank" />}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
        최저 호가 기준 · LTV 70%(수도권)·30년 원리금균등 · 취득세·중개보수 별도 · 실행 전 DSR 한도 확인 필요
      </p>
    </div>
  );
}
