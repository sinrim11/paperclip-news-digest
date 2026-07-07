/**
 * versus-model.ts — 아파트 매수 vs S&P500 지수 ETF 장기(10년) 비교 시뮬레이션 라이브러리.
 *
 * 프로필(재무 전제) 기반으로 요청 시 계산 — /versus 페이지·gen-listings(매물별 vs 요약)가 공유.
 * Path A(매수→2년실거주→전세전환→2년마다 보증금 재마킹→10년 매도 비과세) vs
 * Path B(전세유지+지수 ETF 적립: 배당 매년 15.4% 과세 후 재투자·차익 22% 실현과세).
 * 세후 변환은 investment-model의 etfTax 단일 설정을 공유. 단위: 만원.
 */
import type { PolicyParams, ReaderFinances } from './tracker';
import { computeInvestment, type InvestmentModel } from './investment-model';

export const HORIZON_YEARS = 10;
export const JEONSE_RATIO_DEFAULT = 68; // 전세가율 기본(실측 근사)
export const R_GRID = [6, 8, 10]; // S&P500 총수익: 비관/계획/역사평균
export const G_GRID = [0, 2, 3, 4, 5];
const NEG_POOL_RATE = 0.065; // 부족분 마이너스통장 브리지(연)
const SELL_COST_PCT = 0.5;
const APT_CGT_OVER12 = 0.24;

/** 프로필에서 versus 입력 추출(만원 변환 일원화) */
export interface VersusInputs {
  usableManwon: number;
  savingManwon: number; // 월
  jeonseSelfManwon: number; // 현 전세 본인 보증금
  jeonseInterestManwon: number; // 현 전세대출이자(월)
}
export function versusInputsFrom(fin: ReaderFinances): VersusInputs {
  return {
    usableManwon: (fin.usableCapital ?? 0) / 10000,
    savingManwon: (fin.cashflow?.monthlyHomeSaving ?? 0) / 10000,
    jeonseSelfManwon: (fin.jeonseDepositSelf ?? 0) / 10000,
    jeonseInterestManwon: (fin.jeonseLoanInterestMonthly ?? 0) / 10000,
  };
}

/** 매수 자금조달(가격·프로필당 1회 — g/r 루프 밖에서 계산해 재사용) */
export interface Financing { loan: number; equityIn: number; monthlyPayment: number; acqTaxNet: number; bindingCap: string }
export function financingOf(P: number, jeonseRatioPct: number, fin: ReaderFinances, params: PolicyParams, model: InvestmentModel): Financing {
  const a = computeInvestment({ priceManwon: P, jeonseRatioPct, tradeCount: 0 }, fin, params, model);
  return { loan: a.loan, equityIn: a.equityIn, monthlyPayment: a.monthlyPayment, acqTaxNet: a.acqTaxNet, bindingCap: a.bindingCap };
}

function etfTaxOf(model: InvestmentModel) {
  return model.etfTax ?? { cgtPct: 22, divYieldPct: 1.5, divTaxPct: 15.4, interestTaxPct: 15.4 };
}

/** 지수 ETF 월 성장: 가격수익 + 세후 배당 재투자(원금 가산 → 이중과세 방지) */
function growEtf(pool: number, rPct: number, model: InvestmentModel): { pool: number; basisAdd: number } {
  const t = etfTaxOf(model);
  const priceR = (pool * (rPct - t.divYieldPct)) / 100 / 12;
  const divR = (pool * t.divYieldPct * (1 - t.divTaxPct / 100)) / 100 / 12;
  return { pool: pool + priceR + divR, basisAdd: divR };
}

export interface SimResult { netWorth: number; sale: number; depositLiab: number; pool: number; stockTax: number; aptTax: number; series: number[] }

/** Path A. variant: 'A1'(전환 후 저비용 주거—본가 등) | 'A2'(동급 전세 재진입) */
export function simulateBuy(P: number, gPct: number, rPct: number, variant: 'A1' | 'A2', jeonseRatioPct: number, f: Financing, vi: VersusInputs, model: InvestmentModel): SimResult {
  const jr = jeonseRatioPct / 100;
  const mRate = model.loanRatePct / 100 / 12;
  const months = HORIZON_YEARS * 12;
  const t = etfTaxOf(model);

  let pool = vi.usableManwon - f.equityIn - f.acqTaxNet;
  let principal = pool;
  let bal = f.loan;
  let depositLiab = 0;
  const series: number[] = [];

  for (let m = 1; m <= months; m++) {
    const V = P * Math.pow(1 + gPct / 100, m / 12);
    const propTaxM = (V * (model.propertyTaxAnnualPctOfPrice / 100)) / 12;
    let flow: number;
    if (m <= 24) {
      const int = bal * mRate;
      bal -= f.monthlyPayment - int;
      flow = vi.savingManwon + vi.jeonseInterestManwon - f.monthlyPayment - propTaxM;
    } else {
      flow = (variant === 'A1' ? vi.savingManwon + vi.jeonseInterestManwon : vi.savingManwon) - propTaxM;
    }
    if (pool >= 0) {
      const g2 = growEtf(pool, rPct, model);
      pool = g2.pool;
      principal += g2.basisAdd;
    } else {
      pool *= 1 + NEG_POOL_RATE / 12;
    }
    pool += flow;
    principal += flow;

    if (m === 24) {
      const D = jr * V;
      pool += D - bal;
      principal += D - bal;
      depositLiab = D;
      bal = 0;
      if (variant === 'A2') { pool -= vi.jeonseSelfManwon; principal -= vi.jeonseSelfManwon; }
    } else if (m > 24 && (m - 24) % 24 === 0 && m < months) {
      const D = jr * V;
      pool += D - depositLiab;
      principal += D - depositLiab;
      depositLiab = D;
    }
    if (m % 12 === 0) series.push(Math.round(V - bal - depositLiab + pool + (variant === 'A2' && m >= 24 ? vi.jeonseSelfManwon : 0)));
  }

  const V = P * Math.pow(1 + gPct / 100, HORIZON_YEARS);
  const sale = V * (1 - SELL_COST_PCT / 100);
  const aptTax = sale > 120000 ? (V - P) * ((sale - 120000) / sale) * APT_CGT_OVER12 : 0;
  const stockTax = (t.cgtPct / 100) * Math.max(0, pool - principal);
  const netWorth = sale - depositLiab - aptTax + pool - stockTax + (variant === 'A2' ? vi.jeonseSelfManwon : 0);
  return { netWorth: Math.round(netWorth), sale: Math.round(sale), depositLiab: Math.round(depositLiab), pool: Math.round(pool), stockTax: Math.round(stockTax), aptTax: Math.round(aptTax), series };
}

/** Path B: 전세 유지 + 지수 ETF 적립 */
export function simulateStock(rPct: number, vi: VersusInputs, model: InvestmentModel): SimResult {
  const months = HORIZON_YEARS * 12;
  const t = etfTaxOf(model);
  let pool = vi.usableManwon - vi.jeonseSelfManwon; // 보증금은 전세에 락업(수익 0)
  let principal = pool;
  const series: number[] = [];
  for (let m = 1; m <= months; m++) {
    const g2 = growEtf(pool, rPct, model);
    pool = g2.pool + vi.savingManwon;
    principal += g2.basisAdd + vi.savingManwon;
    if (m % 12 === 0) series.push(Math.round(pool + vi.jeonseSelfManwon));
  }
  const stockTax = (t.cgtPct / 100) * Math.max(0, pool - principal);
  return { netWorth: Math.round(pool - stockTax + vi.jeonseSelfManwon), sale: 0, depositLiab: 0, pool: Math.round(pool), stockTax: Math.round(stockTax), aptTax: 0, series };
}

/** r 고정 시 A와 B가 같아지는 손익분기 상승률 g*(이분탐색) */
export function crossoverG(P: number, rPct: number, variant: 'A1' | 'A2', jeonseRatioPct: number, f: Financing, vi: VersusInputs, model: InvestmentModel, iters = 24): number {
  const B = simulateStock(rPct, vi, model).netWorth;
  let lo = -3, hi = 10;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (simulateBuy(P, mid, rPct, variant, jeonseRatioPct, f, vi, model).netWorth >= B) hi = mid; else lo = mid;
  }
  return Math.round(hi * 10) / 10;
}

/** 매물별 10년 요약(보수적 A2·계획수익 r=8): 승자 + 손익분기 g* */
export interface VersusSummary { gStar: number; winner: 'APT' | 'STOCK'; a10: number; b10: number; rPct: number }
export function versusSummary(P: number, jeonseRatioPct: number, apprBasePct: number, f: Financing, vi: VersusInputs, model: InvestmentModel): VersusSummary {
  const r = 8;
  const a = simulateBuy(P, apprBasePct, r, 'A2', jeonseRatioPct, f, vi, model);
  const b = simulateStock(r, vi, model);
  const gStar = crossoverG(P, r, 'A2', jeonseRatioPct, f, vi, model, 18);
  return { gStar, winner: a.netWorth >= b.netWorth ? 'APT' : 'STOCK', a10: a.netWorth, b10: b.netWorth, rPct: r };
}

/** /versus 페이지용 전체 구조(기존 versus-analysis.json과 동형) */
export function buildVersus(fin: ReaderFinances, params: PolicyParams, model: InvestmentModel, prices = [55000, 68000, 78000]) {
  const vi = versusInputsFrom(fin);
  const jr = JEONSE_RATIO_DEFAULT;
  const priceBlocks = prices.map((P) => {
    const f = financingOf(P, jr, fin, params, model);
    const pool0 = vi.usableManwon - f.equityIn - f.acqTaxNet;
    const grid = G_GRID.map((g) => ({
      g,
      cells: R_GRID.map((r) => {
        const a1 = simulateBuy(P, g, r, 'A1', jr, f, vi, model);
        const a2 = simulateBuy(P, g, r, 'A2', jr, f, vi, model);
        const b = simulateStock(r, vi, model);
        return { r, A1: a1.netWorth, A2: a2.netWorth, B: b.netWorth, winner: a1.netWorth >= b.netWorth && a2.netWorth >= b.netWorth ? 'APT' : a1.netWorth >= b.netWorth ? 'APT_A1' : 'STOCK' };
      }),
    }));
    const crossovers = R_GRID.map((r) => ({ r, gA1: crossoverG(P, r, 'A1', jr, f, vi, model), gA2: crossoverG(P, r, 'A2', jr, f, vi, model) }));
    const detA1 = simulateBuy(P, 3, 8, 'A1', jr, f, vi, model);
    const detA2 = simulateBuy(P, 3, 8, 'A2', jr, f, vi, model);
    const detB = simulateStock(8, vi, model);
    return {
      price: P, loan: f.loan, equityIn: f.equityIn, bindingCap: f.bindingCap, monthlyPayment: Math.round(f.monthlyPayment), acqTaxNet: Math.round(f.acqTaxNet),
      pool0: Math.round(pool0), feasibleToday: pool0 >= -4000,
      grid, crossovers,
      series: {
        years: Array.from({ length: HORIZON_YEARS }, (_, i) => i + 1),
        A1g3: simulateBuy(P, 3, 8, 'A1', jr, f, vi, model).series,
        A1g4: simulateBuy(P, 4, 8, 'A1', jr, f, vi, model).series,
        B: detB.series,
      },
      detail: {
        g3r8: {
          A1: { netWorth: detA1.netWorth, sale: detA1.sale, depositLiab: detA1.depositLiab, pool: detA1.pool, stockTax: detA1.stockTax, aptTax: detA1.aptTax },
          A2: { netWorth: detA2.netWorth },
          B: { netWorth: detB.netWorth, pool: detB.pool, stockTax: detB.stockTax },
        },
      },
    };
  });
  const t = etfTaxOf(model);
  return {
    horizonYears: HORIZON_YEARS,
    assumptions: {
      usableCapitalManwon: Math.round(vi.usableManwon),
      monthlySavingManwon: Math.round(vi.savingManwon),
      jeonseDepositSelfManwon: Math.round(vi.jeonseSelfManwon),
      jeonseLoanInterestM: Math.round(vi.jeonseInterestManwon),
      jeonseRatioPct: jr,
      loanRatePct: model.loanRatePct,
      negPoolRatePct: NEG_POOL_RATE * 100,
      sellCostPct: SELL_COST_PCT,
      stockCgtPct: t.cgtPct,
      divYieldPct: t.divYieldPct,
      divTaxPct: t.divTaxPct,
    },
    prices: priceBlocks,
  };
}
