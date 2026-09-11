/**
 * monthly-cost.ts — 총 월 실부담 (2026-09-12).
 *
 * 왜 만들었나: 우리는 대출 원리금만 보여줬다. "월 112만이면 되겠네"로 읽히지만 실제로는
 * 관리비와 재산세가 더 붙는다. 원리금만 제시하는 건 정보 부족이 아니라 **과소 표시를
 * 조장**하는 쪽에 가깝다 — 집 처음 사는 사람이 가장 크게 오판하는 지점이다.
 *
 * 세 축의 출처가 다르다:
 *   원리금  = policy-loans(구매자 유형별 LTV·정책대출)
 *   관리비  = K-apt 개별사용료(전기·난방·수도·가스) + 장기수선충당금, 세대당으로 환산
 *   재산세  = 공시가격(vworld) 기반 결정론적 계산
 * 하나라도 없으면 그 항목을 빼고 "일부 미포함"으로 표시한다 — 없는 값을 0으로 두면
 * 총액이 작아 보여 같은 오판을 만든다.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface KaptFee {
  month: string;
  commonTotal: number | null;
  individualTotal: number | null;
  ltrmMonthly: number | null;
  ltrmBalance: number | null;
}
export interface KaptRecord {
  kaptCode: string;
  kaptName: string;
  kaptAddr?: string | null;
  household: number | null;
  parkingTotal: number | null;
  parkingPerHousehold: number | null;
  subwayLine: string | null;
  subwayStation: string | null;
  subwayWalkMin: string | null;
  fee: KaptFee | null;
  fetchedAt: string;
}

let cache: Record<string, KaptRecord> | null | undefined;
function load(): Record<string, KaptRecord> | null {
  if (cache !== undefined) return cache;
  try { cache = JSON.parse(readFileSync(join(process.cwd(), 'config', 'kapt-cache.json'), 'utf-8')); }
  catch { cache = null; }
  return cache ?? null;
}

export function kaptOf(complexNo: string): KaptRecord | null {
  return load()?.[complexNo] ?? null;
}

/**
 * 세대당 월 관리비(원). 개별사용료는 세대 부과분이라 세대수로 나눈다.
 * 공용관리비(청소·경비·수선유지)는 이 API 집합에 없어 빠진다 — 실제 고지서는 이보다 크다.
 */
export function monthlyFeeOf(rec: KaptRecord | null): { perHousehold: number; hasLtrm: boolean } | null {
  if (!rec?.fee || !rec.household) return null;
  const hh = rec.household;
  const indiv = rec.fee.individualTotal ?? 0;
  const ltrm = rec.fee.ltrmMonthly ?? 0;
  if (indiv <= 0 && ltrm <= 0) return null;
  return { perHousehold: Math.round((indiv + ltrm) / hh), hasLtrm: ltrm > 0 };
}

/**
 * 재산세 월할(원) — 공시가격 기준 결정론적 계산.
 * 과세표준 = 공시가격 × 공정시장가액비율(1주택 특례 45%)
 * 세율 누진(1주택 특례): 6천만↓ 0.05% / 1.5억↓ 3만+초과분 0.1% / 3억↓ 12만+초과분 0.2% / 초과 42만+0.35%
 * 여기에 지방교육세(재산세의 20%)와 도시지역분(과표 0.14%)을 더한다.
 */
export function propertyTaxMonthly(publicPriceWon: number): number | null {
  if (!publicPriceWon || publicPriceWon <= 0) return null;
  const base = publicPriceWon * 0.45;
  let tax: number;
  if (base <= 60_000_000) tax = base * 0.0005;
  else if (base <= 150_000_000) tax = 30_000 + (base - 60_000_000) * 0.001;
  else if (base <= 300_000_000) tax = 120_000 + (base - 150_000_000) * 0.002;
  else tax = 420_000 + (base - 300_000_000) * 0.0035;
  const eduTax = tax * 0.2;          // 지방교육세
  const cityTax = base * 0.0014;     // 도시지역분
  return Math.round((tax + eduTax + cityTax) / 12);
}

export interface MonthlyBreakdown {
  loan: number;            // 원리금(만원)
  feeWon: number | null;   // 관리비(원/월)
  taxWon: number | null;   // 재산세(원/월)
  totalWon: number;        // 합계(원/월)
  missing: string[];       // 빠진 항목 — 없는 걸 0으로 두면 총액이 작아 보인다
}

export function monthlyBreakdown(
  loanMonthlyManwon: number,
  rec: KaptRecord | null,
  publicPriceWon: number | null,
): MonthlyBreakdown {
  const fee = monthlyFeeOf(rec);
  const tax = publicPriceWon ? propertyTaxMonthly(publicPriceWon) : null;
  const missing: string[] = [];
  if (!fee) missing.push('관리비');
  if (!tax) missing.push('재산세');
  return {
    loan: loanMonthlyManwon,
    feeWon: fee?.perHousehold ?? null,
    taxWon: tax,
    totalWon: loanMonthlyManwon * 10_000 + (fee?.perHousehold ?? 0) + (tax ?? 0),
    missing,
  };
}

/** 표시용 — "약 133만원" 형태. 만원 단위 반올림. */
export const manwonText = (won: number) => `${Math.round(won / 10_000).toLocaleString()}만원`;
