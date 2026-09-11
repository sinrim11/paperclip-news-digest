/**
 * policy-loans.ts — 무주택 정책대출 경로 계산 (2026-08-29, 웹·카드뉴스 공용).
 *
 * 카드뉴스에만 있던 로직을 웹에서도 쓰려고 공용화한다. 수치는 config/policy-loans.json
 * (주택도시기금 공식 안내 원문)에서 읽으며, 정책대출은 금리가 낮은 대신 한도가 작아
 * "필요 현금이 오히려 커지는" 트레이드오프가 있으므로 한쪽만 보여주지 않는다.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { monthlyPaymentPerWon } from './tracker';

interface LoanProduct {
  id: string; label: string; ratePctMin?: number; ratePctMax?: number; rateTypicalPct?: number;
  ratePctTypical?: number; capManwon: number; maxPriceManwon?: number; ltv: number;
  eligibility: string; eligibilityShort?: string; termYears?: number;
}
export interface BuyerType {
  id: string;
  label: string;
  ltv: number;
  policyProductId: string | null;
  note?: string;
}
interface PolicyLoans { products: LoanProduct[]; bank: LoanProduct; buyerTypes?: BuyerType[] }

export interface LoanPath {
  id: string; label: string; loan: number; cash: number; monthly: number;
  rateText: string; eligibility: string;
}

let cache: PolicyLoans | null | undefined;
function load(): PolicyLoans | null {
  if (cache !== undefined) return cache;
  try { cache = JSON.parse(readFileSync(join(process.cwd(), 'config', 'policy-loans.json'), 'utf-8')) as PolicyLoans; }
  catch { cache = null; }
  return cache;
}

function pathOf(priceManwon: number, p: LoanProduct): LoanPath {
  const rate = p.rateTypicalPct ?? p.ratePctTypical ?? 4.5;
  const loan = Math.min(Math.floor(priceManwon * p.ltv), p.capManwon);
  return {
    id: p.id,
    label: p.label,
    loan,
    cash: priceManwon - loan,
    monthly: Math.round(loan * monthlyPaymentPerWon(rate, p.termYears ?? 30)),
    rateText: p.ratePctMin != null && p.ratePctMax != null ? `${p.ratePctMin}~${p.ratePctMax}%` : `${rate}%`,
    eligibility: p.eligibilityShort ?? p.eligibility,
  };
}

/** 구매자 유형 목록 — 화면의 선택 축. 없으면 생애최초 하나로 폴백. */
export function buyerTypes(): BuyerType[] {
  return load()?.buyerTypes ?? [{ id: 'firstTime', label: '생애최초 무주택', ltv: 0.7, policyProductId: 'didimdol' }];
}

export const DEFAULT_BUYER_TYPE = 'firstTime';

/**
 * 가격에 적용 가능한 경로. policy는 주택가 상한 이내일 때만(초과 시 blockedBy 사유).
 *
 * buyerTypeId(2026-09-12) — 종전엔 생애최초 하나로만 계산해, 생애최초가 아닌 사람은
 * 자기 조건과 다른 숫자를 보고 있었다. LTV가 70%냐 40%냐로 필요 현금이 억 단위로 갈린다.
 */
export function loanRoutes(priceManwon: number, buyerTypeId: string = DEFAULT_BUYER_TYPE): {
  policy: LoanPath | null; policyBlockedBy: string | null; bank: LoanPath | null; buyerType: BuyerType;
} {
  const cfg = load();
  const bt = buyerTypes().find((b) => b.id === buyerTypeId) ?? buyerTypes()[0];
  if (!cfg) return { policy: null, policyBlockedBy: null, bank: null, buyerType: bt };

  const prod = bt.policyProductId ? cfg.products.find((p) => p.id === bt.policyProductId) : undefined;
  const eok = (m: number) => (m / 10000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + '억';
  const overPrice = prod ? priceManwon > (prod.maxPriceManwon ?? Infinity) : false;

  // 은행 경로는 유형의 LTV를 따른다 — 생애최초 예외(70%)를 못 받으면 40%로 계산해야 맞다.
  const bank = pathOf(priceManwon, { ...cfg.bank, ltv: bt.ltv });

  return {
    policy: prod && !overPrice ? pathOf(priceManwon, prod) : null,
    policyBlockedBy: !prod
      ? '이 유형은 정책대출 대상이 아닙니다'
      : overPrice
        ? `주택가 ${eok(prod.maxPriceManwon!)} 초과`
        : null,
    bank,
    buyerType: bt,
  };
}

/**
 * 비교표용 — 정책대출이 되면 그 경로, 아니면 은행 기준.
 * 월 상환만 보면 디딤돌 한도(2.4억)에 걸린 매물이 전부 같은 값이라 비교가 안 된다.
 * 가격차가 그대로 드러나는 '필요 현금'을 함께 돌려준다.
 */
export function bestRoute(priceManwon: number, buyerTypeId: string = DEFAULT_BUYER_TYPE): { monthly: number; cash: number; via: string } | null {
  const r = loanRoutes(priceManwon, buyerTypeId);
  const p = r.policy ?? r.bank;
  return p ? { monthly: p.monthly, cash: p.cash, via: r.policy ? (r.policy.label.split(' ')[0] ?? '정책') : '은행' } : null;
}
