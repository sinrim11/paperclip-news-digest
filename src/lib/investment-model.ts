/**
 * investment-model.ts — 매수→2년 실거주→전세/월세 전환 투자수익(ROE) 엔진.
 *
 * 시나리오(Path A): 매매가 P로 매수(생애최초 LTV70%·DSR 한도로 대출) → 2년 실거주(원리금 상환)
 *   → 2년 후 전세/월세 전환(전세보증금으로 대출 상환 → 이자부담 감소).
 * 산출: 자기자본 대비 2년 수익률(ROE, 집값상승 3시나리오) · 대안투자(주식·채권) 대비 초과수익
 *   · 전세전환 시 이자 감소율 · 월세전환 시 월 현금흐름 · 영역별 점수(근거 금액 명시)→종합점수.
 *
 * 모든 금액 단위: 만원. config/investment-model.json + policy-params + reader-profile 소비.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { PolicyParams, ReaderFinances } from './tracker';

export interface InvestmentModel {
  loanRatePct: number;
  loanTermYears: number;
  holdYears: number;
  appreciationScenariosPct: Record<string, number>;
  baseScenario: string;
  regionAppreciation?: { neutralPct: number; perHeatStepPct: number; heatAnchor: number; minPct: number; maxPct: number; conservativeDeltaPct: number; optimisticDeltaPct: number };
  altReturnsPct: Record<string, number>;
  etfTax?: { cgtPct: number; divYieldPct: number; divTaxPct: number; interestTaxPct: number };
  benchmarkPct: number;
  jeonseToWolseConversionPct: number;
  wolseDepositRatio: number;
  acquisitionTaxPct: number;
  firstTimeAcqTaxReliefManwon: number;
  propertyTaxAnnualPctOfPrice: number;
  weights: Record<string, number>;
  weightsLive?: Record<string, number>; // 실거주 목적 가중치(통근·상권 포함)
  scoreBands: any;
}

export function loadInvestmentModel(): InvestmentModel | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'config', 'investment-model.json'), 'utf-8')) as InvestmentModel;
  } catch {
    return null;
  }
}

/** regionHeat(1~4)로 지역 기본 상승률(%) 산출. heat 없으면 neutral. */
export function regionApprPct(model: InvestmentModel, heat: number | null | undefined): number {
  const ra = model.regionAppreciation;
  if (!ra) return model.appreciationScenariosPct[model.baseScenario] ?? 3;
  const h = heat == null ? ra.heatAnchor : heat;
  return Math.round((Math.max(ra.minPct, Math.min(ra.maxPct, ra.neutralPct + (h - ra.heatAnchor) * ra.perHeatStepPct))) * 10) / 10;
}

const annuityPerWon = (ratePct: number, termYears: number) => {
  const m = ratePct / 100 / 12;
  const n = termYears * 12;
  return m === 0 ? 1 / n : (m * Math.pow(1 + m, n)) / (Math.pow(1 + m, n) - 1);
};

/** loan을 ratePct·termYears 원리금균등으로 months개월 상환했을 때 이자·원금·잔존 */
function amortize(loan: number, ratePct: number, termYears: number, months: number) {
  const m = ratePct / 100 / 12;
  const pay = loan * annuityPerWon(ratePct, termYears);
  let bal = loan;
  let interest = 0;
  let principal = 0;
  for (let i = 0; i < months; i++) {
    const int = bal * m;
    const prin = pay - int;
    interest += int;
    principal += prin;
    bal -= prin;
  }
  return { monthlyPayment: pay, interest, principal, remaining: Math.max(0, bal) };
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const mapScore = (v: number, min: number, max: number) => clamp(((v - min) / (max - min)) * 100);

export interface DimScore {
  key: string;
  label: string;
  score: number; // 0~100
  weight: number;
  formula: string; // 계산식(공식) — "점수 = clamp((X−a)/(b−a)×100)"
  basis: string; // 판단 근거 — 실제 대입값·데이터 출처
}

export interface ApprReturn {
  scenario: string;
  apprPct: number;
  futureValue: number; // 2년 후 평가액
  gain: number; // 자산 상승분
  netProfit: number; // gain − 보유비용
  roe2yrPct: number; // 자기자본 대비 2년 수익률
  roeAnnualPct: number; // 연환산(CAGR)
}

export interface InvestmentAnalysis {
  priceManwon: number;
  jeonseRatioPct: number;
  // 자금조달
  loan: number;
  equityIn: number;
  ltvLoan: number;
  dsrLoanCap: number;
  policyCap: number;
  bindingCap: 'LTV' | 'DSR' | '정책한도(6억)';
  feasibleToday: boolean;
  feasible2yr: boolean;
  usableToday: number;
  projected2yr: number;
  // 보유(2년)
  monthlyPayment: number;
  interest2yr: number;
  principal2yr: number;
  remainingLoan: number;
  acqTaxNet: number;
  propertyTax2yr: number;
  holdingCost: number;
  // 수익(시나리오별)
  returns: ApprReturn[];
  base: ApprReturn;
  // 전세전환
  jeonseDeposit: number;
  loanClearedByJeonse: boolean;
  cashReleased: number;
  fwdInterestMonthlyAfterJeonse: number;
  interestReductionPct: number;
  // 월세전환
  wolseDeposit: number;
  wolseMonthly: number;
  wolseNetMonthlyCashflow: number;
  // 대안 비교(base 기준)
  altProfits: Record<string, number>;
  excessVsStock: number;
  excessVsBond: number;
  breakevenApprPct: number;
  altVerdict: string;
  // 점수
  scores: DimScore[];
  totalScore: number;
}

export interface InvestInput {
  priceManwon: number;
  jeonseRatioPct: number;
  tradeCount?: number;
  buildYear?: number | null;
  exclusiveArea?: number | null;
  elapsedYear?: number | null;
  household?: number | null;
  apprBasePct?: number | null; // 지역 기본상승률 override(regionApprPct). 없으면 model 기본 시나리오.
  // 통근·상권(commute.ts에서 계산해 주입 — 좌표 보유 매물만). purposeLive=true면 weightsLive로 가중 반영, 아니면 표시만(가중 0).
  purposeLive?: boolean;
  commute?: { score: number; formula: string; basis: string } | null;
  amenity?: { score: number; formula: string; basis: string } | null;
}

function policyCapOf(price: number, params: PolicyParams): number {
  for (const t of params.loanCapByPrice) if (t.maxPrice === null || price <= t.maxPrice) return t.cap;
  return params.loanCapByPrice[params.loanCapByPrice.length - 1]?.cap ?? Infinity;
}

/** 억 표기 — 2026-08-27: 기존 정규식이 정수 끝자리 0을 지워 10억→"1억"으로 표기되던 버그 수정(/listings 근거 문구에 노출). */
const eok1 = (m: number) => {
  const v = m / 10000;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '억';
};
const man = (m: number) => Math.round(m).toLocaleString() + '만';

const DEFAULT_ETF_TAX = { cgtPct: 22, divYieldPct: 1.5, divTaxPct: 15.4, interestTaxPct: 15.4 };

/** 대안투자 N년 세후 수익(원금 1 기준). ETF('주식')=배당 매년 과세 후 재투자+차익 22%, 이자상품=이자소득세 15.4%. versus-model과 공유하는 단일 세후 변환 지점. */
export function altNetProfitPerWon(kind: string, rPct: number, years: number, model: InvestmentModel): number {
  const t = model.etfTax ?? DEFAULT_ETF_TAX;
  if (kind === '주식') {
    // 총수익 r 중 배당 divYield는 매년 divTax 과세 후 재투자(원금化) → 차익분만 실현 시 cgt 과세
    const rEff = rPct - (t.divYieldPct * t.divTaxPct) / 100;
    const gross = Math.pow(1 + rEff / 100, years) - 1;
    const divPortion = ((t.divYieldPct * (1 - t.divTaxPct / 100)) / 100) * years; // 세후 배당 재투자 원금(근사)
    const priceGain = Math.max(0, gross - divPortion);
    return divPortion + priceGain * (1 - t.cgtPct / 100);
  }
  // 채권·예금: 이자소득세 15.4% (연 과세 근사)
  const rNet = rPct * (1 - t.interestTaxPct / 100);
  return Math.pow(1 + rNet / 100, years) - 1;
}

export function computeInvestment(input: InvestInput, fin: ReaderFinances, params: PolicyParams, model: InvestmentModel): InvestmentAnalysis {
  const P = input.priceManwon;
  const jr = input.jeonseRatioPct || 0;

  // ── 자금조달 (모든 계산 '만원'. reader-profile/policy는 '원' 단위 → /10000 변환) ──
  const toManwon = (won: number) => won / 10000;
  const ltv = params.ltv.regulatedBase + params.ltv.firstTimeBonus; // 생애최초 0.7
  const ltvLoan = Math.floor(P * ltv);
  const stressRate = params.dsr.assumedBaseRatePct + params.dsr.stressAddPctRegulated;
  // 마통 해지 가정(매수 전 최우선 조치·[[project-financial-prep-plan]]) → 마통은 0으로 DSR 산정.
  // 단, 프로필의 기존 대출 월상환(existingLoanMonthly)은 실상환 부채라 DSR 여력에서 차감.
  const existingLoanM = fin.existingLoanMonthly ?? 0; // 원/월
  const monthlyCapWon = Math.max(0, (fin.annualIncome * params.dsr.ratio) / 12 - existingLoanM);
  const dsrLoanCap = Math.floor(toManwon(monthlyCapWon / annuityPerWon(stressRate, params.dsr.termYears)));
  const policyCap = toManwon(policyCapOf(P * 10000, params));
  const loan = Math.max(0, Math.min(ltvLoan, dsrLoanCap, policyCap));
  const bindingCap: InvestmentAnalysis['bindingCap'] = loan === ltvLoan ? 'LTV' : loan === dsrLoanCap ? 'DSR' : '정책한도(6억)';
  const equityIn = Math.max(0, P - loan);
  const usableToday = toManwon(fin.usableCapital);
  const projected2yr = usableToday + toManwon((fin.cashflow?.monthlyHomeSaving ?? 0) * 24);
  const incomeNetManwon = toManwon(fin.cashflow?.monthlyIncomeNet ?? 0);

  // ── 보유(2년, 실행금리) ──
  const holdMonths = model.holdYears * 12;
  const am = amortize(loan, model.loanRatePct, model.loanTermYears, holdMonths);
  const acqTaxNet = Math.max(0, P * (model.acquisitionTaxPct / 100) - model.firstTimeAcqTaxReliefManwon);
  const propertyTax2yr = P * (model.propertyTaxAnnualPctOfPrice / 100) * model.holdYears;
  const holdingCost = am.interest + acqTaxNet + propertyTax2yr;

  // ── 수익 시나리오 (지역 상승률 override 있으면 그것으로 3시나리오 구성) ──
  const ra = model.regionAppreciation;
  const scenarioMap: Record<string, number> = input.apprBasePct != null && ra
    ? { conservative: Math.max(0, input.apprBasePct + ra.conservativeDeltaPct), base: input.apprBasePct, optimistic: input.apprBasePct + ra.optimisticDeltaPct }
    : model.appreciationScenariosPct;
  const returns: ApprReturn[] = Object.entries(scenarioMap).map(([scenario, apprPct]) => {
    const fv = P * Math.pow(1 + apprPct / 100, model.holdYears);
    const gain = fv - P;
    const netProfit = gain - holdingCost;
    const roe2yr = equityIn > 0 ? (netProfit / equityIn) * 100 : 0;
    const roeAnnual = equityIn > 0 ? (Math.pow(1 + netProfit / equityIn, 1 / model.holdYears) - 1) * 100 : 0;
    return { scenario, apprPct, futureValue: fv, gain, netProfit, roe2yrPct: roe2yr, roeAnnualPct: roeAnnual };
  });
  const base = returns.find((r) => r.scenario === model.baseScenario) ?? returns[0];

  // ── 전세전환(base 평가액 기준) ──
  const jeonseDeposit = base.futureValue * (jr / 100);
  const cleared = jeonseDeposit >= am.remaining;
  const cashReleased = cleared ? jeonseDeposit - am.remaining : 0;
  const remAfterJeonse = cleared ? 0 : am.remaining - jeonseDeposit;
  const fwdInterestMonthlyAfterJeonse = (remAfterJeonse * model.loanRatePct) / 100 / 12;
  const interestBeforeMonthly = (am.remaining * model.loanRatePct) / 100 / 12;
  const interestReductionPct = interestBeforeMonthly > 0 ? ((interestBeforeMonthly - fwdInterestMonthlyAfterJeonse) / interestBeforeMonthly) * 100 : 0;

  // ── 월세전환 ──
  const wolseDeposit = jeonseDeposit * model.wolseDepositRatio;
  const wolseMonthly = ((jeonseDeposit - wolseDeposit) * model.jeonseToWolseConversionPct) / 100 / 12;
  const repayByWolseDeposit = Math.min(wolseDeposit, am.remaining);
  const remAfterWolse = am.remaining - repayByWolseDeposit;
  const wolseInterestMonthly = (remAfterWolse * model.loanRatePct) / 100 / 12;
  const wolseNetMonthlyCashflow = wolseMonthly - wolseInterestMonthly;

  // ── 대안 비교(base netProfit 대비, 세후) — 아파트 순익은 1주택 비과세·미실현 평가라 세전=세후 ──
  const altProfits: Record<string, number> = {};
  for (const [k, v] of Object.entries(model.altReturnsPct)) altProfits[k] = equityIn * altNetProfitPerWon(k, v, model.holdYears, model);
  const excessVsStock = base.netProfit - (altProfits['주식'] ?? 0);
  const excessVsBond = base.netProfit - (altProfits['채권'] ?? 0);
  // 손익분기 연 상승률 = 자산상승이 보유비용을 상쇄하는 지점(매매가 기준)
  const breakevenApprPct = (Math.pow(1 + holdingCost / P, 1 / model.holdYears) - 1) * 100;
  const altVerdict =
    excessVsStock >= 0
      ? `기본 ${base.apprPct}% 상승 가정 시 S&P500 ETF(세전 ${model.altReturnsPct['주식']}%·세후)보다 ${man(excessVsStock)} 우위 — 레버리지+비과세 효과(손익분기 ${breakevenApprPct.toFixed(1)}%/년)`
      : excessVsBond >= 0
        ? `S&P500 ETF(세전 ${model.altReturnsPct['주식']}%·세후)엔 미달하나 채권(세후)보다 ${man(excessVsBond)} 우위 — 손익분기 ${breakevenApprPct.toFixed(1)}%/년`
        : `기본 ${base.apprPct}% 상승 가정 시 순손실(대안 미달) — 연 ${breakevenApprPct.toFixed(1)}% 이상 상승해야 본전(역캐리 구간). 상승 여력 확신 시에만.`;

  // ── 영역별 점수 ──
  const b = model.scoreBands;
  const headroom = projected2yr > 0 ? (projected2yr - equityIn) / projected2yr : -1;
  const cover = am.remaining > 0 ? jeonseDeposit / am.remaining : 2;
  const existingLoanManwon = toManwon(existingLoanM);
  const burden = incomeNetManwon > 0 ? (am.monthlyPayment + existingLoanManwon) / incomeNetManwon : 1;
  const excessAnnual = base.roeAnnualPct - model.benchmarkPct;
  const trades = input.tradeCount ?? 0;

  // 상품성(연식·세대수)
  const age = input.elapsedYear ?? (input.buildYear ? new Date().getFullYear() - input.buildYear : null);
  const ageBand = (b.productQualityByAge as Array<{ maxAge: number; score: number; label: string }>).find((x) => age != null && age <= x.maxAge);
  const ageScore = age == null ? 50 : ageBand?.score ?? 22;
  const hh = input.household ?? 0;
  const hbCfg = b.householdBonus;
  const hhBonus = hh > 0 ? clamp(((hh - hbCfg.min) / (hbCfg.max - hbCfg.min)) * hbCfg.maxBonus, 0, hbCfg.maxBonus) : 0;
  const productScore = clamp(ageScore + hhBonus);

  // 가중치 세트: 실거주 목적 + weightsLive 설정 시 통근·상권 포함 세트, 아니면 투자 기본 세트
  const useLive = !!input.purposeLive && !!model.weightsLive;
  const W = useLive ? model.weightsLive! : model.weights;

  const scores: DimScore[] = [
    {
      key: 'affordability', label: '예산 적합', weight: W.affordability,
      score: mapScore(headroom, b.affordabilityHeadroom.min, b.affordabilityHeadroom.max),
      formula: `점수 = clamp((여유율 − (${b.affordabilityHeadroom.min})) / (${b.affordabilityHeadroom.max} − (${b.affordabilityHeadroom.min})) × 100); 여유율 = (2년후 자기자본 − 필요 자기자본) / 2년후 자기자본`,
      basis: `여유율 = (${eok1(projected2yr)} − ${eok1(equityIn)}) / ${eok1(projected2yr)} = ${(headroom * 100).toFixed(0)}% → ${Math.round(mapScore(headroom, b.affordabilityHeadroom.min, b.affordabilityHeadroom.max))}점. 필요 자기자본 ${eok1(equityIn)}(매매 ${eok1(P)}−대출 ${eok1(loan)}·${bindingCap} 구속)${equityIn <= usableToday ? ' · 오늘도 가능' : feasibleFlag(equityIn, projected2yr)}`,
    },
    {
      key: 'deleverage', label: '전세전환 레버리지', weight: W.deleverage,
      score: mapScore(cover, b.deleverageCover.min, b.deleverageCover.max),
      formula: `점수 = clamp((커버율 − ${b.deleverageCover.min}) / (${b.deleverageCover.max} − ${b.deleverageCover.min}) × 100); 커버율 = 2년후 전세보증금 / 잔존대출`,
      basis: `커버율 = ${eok1(jeonseDeposit)}(평가 ${eok1(base.futureValue)}×전세가율 ${jr}%) / 잔존대출 ${eok1(am.remaining)} = ${Math.round(cover * 100)}% → ${Math.round(mapScore(cover, b.deleverageCover.min, b.deleverageCover.max))}점${cleared ? ` · 전액상환+현금 ${eok1(cashReleased)} 회수(이자 −${Math.round(interestReductionPct)}%)` : ` · 이자 ${man(fwdInterestMonthlyAfterJeonse)}/월 잔존`}`,
    },
    {
      key: 'capReturn', label: '자본수익(ROE)', weight: W.capReturn,
      score: mapScore(base.roeAnnualPct, b.capReturnAnnualPct.min, b.capReturnAnnualPct.max),
      formula: `점수 = clamp((연ROE − (${b.capReturnAnnualPct.min})) / (${b.capReturnAnnualPct.max} − (${b.capReturnAnnualPct.min})) × 100); 연ROE = (1 + 순익/자기자본)^(1/${model.holdYears}) − 1; 순익 = 자산상승 − 보유비용`,
      basis: `${base.apprPct}% 상승(지역) 가정: 자산 +${man(base.gain)} − 보유비용 ${man(holdingCost)}(이자 ${man(am.interest)}+취득세 ${man(acqTaxNet)}+재산세 ${man(propertyTax2yr)}) = 순익 ${man(base.netProfit)} / 자기자본 ${eok1(equityIn)} → 연ROE ${base.roeAnnualPct.toFixed(1)}% → ${Math.round(mapScore(base.roeAnnualPct, b.capReturnAnnualPct.min, b.capReturnAnnualPct.max))}점`,
    },
    {
      key: 'carry', label: '보유부담(캐리)', weight: W.carry,
      score: mapScore(b.carryBurdenRatio.bad - burden, 0, b.carryBurdenRatio.bad - b.carryBurdenRatio.good),
      formula: `점수 = clamp((${b.carryBurdenRatio.bad} − 부담률) / (${b.carryBurdenRatio.bad} − ${b.carryBurdenRatio.good}) × 100); 부담률 = (월 원리금 + 기존대출 상환) / 월 실수령`,
      basis: `부담률 = (월 원리금 ${man(am.monthlyPayment)}${existingLoanManwon > 0 ? ` + 기존대출 ${man(existingLoanManwon)}` : ''}) / 실수령 ${man(incomeNetManwon)} = ${Math.round(burden * 100)}% → ${Math.round(mapScore(b.carryBurdenRatio.bad - burden, 0, b.carryBurdenRatio.bad - b.carryBurdenRatio.good))}점 (실거주라 월세수입 0 → 순유출)`,
    },
    {
      key: 'altExcess', label: '대안 대비 초과수익', weight: W.altExcess,
      score: mapScore(excessAnnual, b.altExcessPct.min, b.altExcessPct.max),
      formula: `점수 = clamp((초과 − (${b.altExcessPct.min})) / (${b.altExcessPct.max} − (${b.altExcessPct.min})) × 100); 초과 = 연ROE − ${model.benchmarkPct}%(S&P500 ETF·채권 세후 혼합)`,
      basis: `초과 = 연ROE ${base.roeAnnualPct.toFixed(1)}% − 세후 혼합 ${model.benchmarkPct}%(S&P500 세전 ${model.altReturnsPct['주식']}·채권 ${model.altReturnsPct['채권']}, ETF 차익 22%·배당 15.4% 과세 반영) = ${excessAnnual >= 0 ? '+' : ''}${excessAnnual.toFixed(1)}%p → ${Math.round(mapScore(excessAnnual, b.altExcessPct.min, b.altExcessPct.max))}점`,
    },
    {
      key: 'liquidity', label: '환금성(실거래)', weight: W.liquidity,
      score: Math.max(b.liquidityTrades.floor, mapScore(trades, b.liquidityTrades.min, b.liquidityTrades.max)),
      formula: `점수 = max(${b.liquidityTrades.floor}, (거래건수 − ${b.liquidityTrades.min}) / (${b.liquidityTrades.max} − ${b.liquidityTrades.min}) × 100)`,
      basis: `최근 180일 실거래 ${trades}건 → ${Math.round(Math.max(b.liquidityTrades.floor, mapScore(trades, b.liquidityTrades.min, b.liquidityTrades.max)))}점 (${trades >= 25 ? '초유동성' : trades >= 10 ? '유동성 양호' : trades >= 3 ? '거래 확인' : '표본 부족'})`,
    },
    {
      key: 'productQuality', label: '상품성(연식)', weight: W.productQuality,
      score: productScore,
      formula: `점수 = 연식밴드(신축 100·준신축 82·구축 62·노후 30·재건축연한 22) + 세대수 보너스(300~1500세대, 최대 ${b.householdBonus.maxBonus})`,
      basis: `${age != null ? `준공 ${age}년차` : '연식미상'}${hh > 0 ? `·${hh.toLocaleString()}세대` : ''} → ${age == null ? 50 : ageScore}점${hhBonus >= 1 ? ` + 대단지 ${Math.round(hhBonus)}` : ''} = ${Math.round(productScore)}점 (${age == null ? '연식 확인 필요' : (ageBand?.label ?? '재건축 연한')})`,
    },
  ];
  // 통근·상권(좌표 보유 매물만 주입됨) — 실거주 목적이면 가중 반영, 투자 목적이면 참고 표시(가중 0)
  if (input.commute) {
    scores.push({
      key: 'commute', label: '통근(출근지)', weight: useLive ? (W.commute ?? 0) : 0,
      score: clamp(input.commute.score), formula: input.commute.formula,
      basis: input.commute.basis + (useLive ? '' : ' · 투자 목적 — 가중 0(참고)'),
    });
  }
  if (input.amenity) {
    scores.push({
      key: 'amenity', label: '상권·생활(근사)', weight: useLive ? (W.amenity ?? 0) : 0,
      score: clamp(input.amenity.score), formula: input.amenity.formula,
      basis: input.amenity.basis + (useLive ? '' : ' · 투자 목적 — 가중 0(참고)'),
    });
  }
  const totalScore = Math.round(scores.reduce((s, d) => s + d.score * d.weight, 0));

  return {
    priceManwon: P, jeonseRatioPct: jr,
    loan, equityIn, ltvLoan, dsrLoanCap, policyCap, bindingCap,
    feasibleToday: equityIn <= usableToday, feasible2yr: equityIn <= projected2yr, usableToday, projected2yr,
    monthlyPayment: am.monthlyPayment, interest2yr: am.interest, principal2yr: am.principal, remainingLoan: am.remaining,
    acqTaxNet, propertyTax2yr, holdingCost,
    returns, base,
    jeonseDeposit, loanClearedByJeonse: cleared, cashReleased, fwdInterestMonthlyAfterJeonse, interestReductionPct,
    wolseDeposit, wolseMonthly, wolseNetMonthlyCashflow,
    altProfits, excessVsStock, excessVsBond, breakevenApprPct, altVerdict,
    scores, totalScore,
  };
}

function feasibleFlag(equityIn: number, projected2yr: number): string {
  return equityIn <= projected2yr ? ' (2년 적립 후 가능)' : ' ⚠️ 자기자본 초과';
}
