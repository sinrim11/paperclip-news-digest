/**
 * invest-compact.ts — InvestmentAnalysis → 페이지용 compact 직렬화(단일 소스).
 * gen-listings·gen-matching(프리컴퓨트)과 /listings·/matching(커스텀 프로필 요청 시 재계산)이 공유
 * → 프리컴퓨트와 라이브 재계산의 수치 정의가 갈라질 수 없음.
 */
import type { PolicyParams, ReaderFinances } from './tracker';
import { computeInvestment, type InvestInput, type InvestmentAnalysis, type InvestmentModel } from './investment-model';
import { versusInputsFrom, versusSummary, type VersusSummary } from './versus-model';

const roe = (a: InvestmentAnalysis, s: string) => +(a.returns.find((r) => r.scenario === s)?.roeAnnualPct ?? 0).toFixed(1);

/** /listings 매물 상세용 compact */
export function listingsCompact(a: InvestmentAnalysis) {
  return {
    totalScore: a.totalScore, equityIn: a.equityIn, loan: a.loan, bindingCap: a.bindingCap,
    ltvLoan: a.ltvLoan, dsrLoanCap: a.dsrLoanCap, remainingLoan: Math.round(a.remainingLoan),
    feasibleToday: a.feasibleToday, feasible2yr: a.feasible2yr, projected2yr: Math.round(a.projected2yr), usableToday: Math.round(a.usableToday),
    monthlyPayment: Math.round(a.monthlyPayment), holdingCost: Math.round(a.holdingCost), interest2yr: Math.round(a.interest2yr),
    acqTaxNet: Math.round(a.acqTaxNet), propertyTax2yr: Math.round(a.propertyTax2yr),
    base: { apprPct: a.base.apprPct, futureValue: Math.round(a.base.futureValue), gain: Math.round(a.base.gain), netProfit: Math.round(a.base.netProfit), roeAnnualPct: +a.base.roeAnnualPct.toFixed(1) },
    conservative: { roeAnnualPct: roe(a, 'conservative') },
    optimistic: { roeAnnualPct: roe(a, 'optimistic') },
    jeonseDeposit: Math.round(a.jeonseDeposit), loanCleared: a.loanClearedByJeonse, cashReleased: Math.round(a.cashReleased),
    interestReductionPct: Math.round(a.interestReductionPct), wolseNetMonthly: Math.round(a.wolseNetMonthlyCashflow),
    breakevenApprPct: +a.breakevenApprPct.toFixed(1), altVerdict: a.altVerdict,
    scores: a.scores.map((s) => ({ label: s.label, score: Math.round(s.score), weight: s.weight, formula: s.formula, basis: s.basis })),
  };
}

/** /matching shortlist·tracked용 compact */
export function matchingCompact(a: InvestmentAnalysis) {
  return {
    totalScore: a.totalScore, equityIn: a.equityIn, loan: a.loan, bindingCap: a.bindingCap,
    ltvLoan: a.ltvLoan, dsrLoanCap: a.dsrLoanCap, remainingLoan: Math.round(a.remainingLoan),
    feasibleToday: a.feasibleToday, feasible2yr: a.feasible2yr, projected2yr: Math.round(a.projected2yr), usableToday: Math.round(a.usableToday),
    monthlyPayment: Math.round(a.monthlyPayment), holdingCost: Math.round(a.holdingCost), interest2yr: Math.round(a.interest2yr),
    acqTaxNet: Math.round(a.acqTaxNet), propertyTax2yr: Math.round(a.propertyTax2yr),
    base: { apprPct: a.base.apprPct, futureValue: Math.round(a.base.futureValue), gain: Math.round(a.base.gain), netProfit: Math.round(a.base.netProfit), roeAnnualPct: +a.base.roeAnnualPct.toFixed(1) },
    conservative: roe(a, 'conservative'),
    optimistic: roe(a, 'optimistic'),
    jeonseDeposit: Math.round(a.jeonseDeposit), loanCleared: a.loanClearedByJeonse, cashReleased: Math.round(a.cashReleased), interestReductionPct: Math.round(a.interestReductionPct),
    wolseNetMonthly: Math.round(a.wolseNetMonthlyCashflow),
    breakevenApprPct: +a.breakevenApprPct.toFixed(1), altVerdict: a.altVerdict,
    scores: a.scores.map((s) => ({ label: s.label, score: Math.round(s.score), weight: s.weight, formula: s.formula, basis: s.basis })),
  };
}

/** 매물 1건: 2년 투자분석 + 10년 집vs주식 요약(vs) 동시 계산 */
export function analyzeWithVersus(input: InvestInput, fin: ReaderFinances, params: PolicyParams, model: InvestmentModel): { a: InvestmentAnalysis; vs: VersusSummary } {
  const a = computeInvestment(input, fin, params, model);
  const vi = versusInputsFrom(fin);
  const f = { loan: a.loan, equityIn: a.equityIn, monthlyPayment: a.monthlyPayment, acqTaxNet: a.acqTaxNet, bindingCap: a.bindingCap };
  const vs = versusSummary(input.priceManwon, input.jeonseRatioPct || 65, a.base.apprPct, f, vi, model);
  return { a, vs };
}
