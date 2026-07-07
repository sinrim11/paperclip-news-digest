/**
 * 매물 후보 추천 점수화 (결정적, LLM 불필요).
 *
 * ComplexCandidate(스윕 결과) + AptTrade(실거래) + reader budget + 지역 Tier를
 * 종합해 0~100 점수와 추천 이유/주의를 산출한다.
 *
 * 축(가중치):
 *   budgetFit   30 — 지금 예산 내 > 완화 시 > 자본성장 필요
 *   liquidity   20 — 세대수(환금성) + 매물 유동성
 *   tier        20 — 투자지역 Tier(신림·봉천·대림 등)
 *   valueGap    15 — 실거래 대비 호가 갭(호가가 실거래에 근접할수록↑)
 *   freshness   10 — 연식(신축 가점, 재건축 연한도 별도 가점)
 *   selection    5 — 예산 내 매물 개수(선택지)
 */

import type { ComplexCandidate } from '@prisma/client';
import { tierOf } from './tiers';

export interface RecoInput {
  candidate: ComplexCandidate;
  /** 같은 이름/동의 최근 실거래 중앙값(만원) — 없으면 null */
  recentTradeMedian: number | null;
  nowBudgetManwon: number | null; // 현행 생초 예산
  easedBudgetManwon: number | null; // 완화 예산
}

export interface Recommendation {
  complexNo: string;
  name: string;
  gu: string;
  dong: string;
  score: number;
  grade: 'S' | 'A' | 'B' | 'C';
  minDealPrice: number | null;
  household: number;
  elapsedYear: number | null;
  inBudgetCount: number;
  reasons: string[];
  cautions: string[];
  breakdown: Record<string, number>;
}

// 투자지역 Tier는 src/lib/tiers.ts로 이전(recommend-engine.ts와 공유). tierOf() import.

function gradeOf(score: number): Recommendation['grade'] {
  if (score >= 75) return 'S';
  if (score >= 60) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}

export function scoreCandidate(input: RecoInput): Recommendation {
  const { candidate: c, recentTradeMedian, nowBudgetManwon, easedBudgetManwon } = input;
  const min = c.minDealPrice;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const bd: Record<string, number> = {};

  // ① budgetFit (30)
  let budgetFit = 0;
  if (min !== null && nowBudgetManwon && min * 10_000 <= nowBudgetManwon) {
    budgetFit = 30;
    reasons.push(`현행 예산으로 지금 매수 가능(최저 ${(min / 10000).toFixed(1)}억)`);
  } else if (min !== null && easedBudgetManwon && min * 10_000 <= easedBudgetManwon) {
    budgetFit = 22;
    reasons.push(`규제 완화 시 사정권(최저 ${(min / 10000).toFixed(1)}억)`);
  } else if (min !== null) {
    budgetFit = 8;
    cautions.push('현재 예산 초과 — 자본 성장 필요');
  }
  bd.budgetFit = budgetFit;

  // ② liquidity (20) — 세대수 + 매물 유동성
  const hhScore = Math.min(12, (c.household / 1500) * 12); // 1500세대에서 만점
  const artScore = Math.min(8, (c.dealArticles / 15) * 8); // 매매매물 15건에서 만점
  const liquidity = Math.round(hhScore + artScore);
  bd.liquidity = liquidity;
  if (c.household >= 1000) reasons.push(`${c.household.toLocaleString()}세대 대단지(환금성·시세 안정)`);
  if (c.dealArticles >= 10) reasons.push(`매매 매물 ${c.dealArticles}건(선택지·협상 여지)`);
  else if (c.dealArticles <= 2) cautions.push(`매물 ${c.dealArticles}건뿐(거래 희소)`);

  // ③ tier (20)
  const tier = tierOf(c.dong);
  bd.tier = tier;
  if (tier >= 16) reasons.push(`투자 우선지역(${c.dong})`);

  // ④ valueGap (15) — 실거래 대비 호가
  let valueGap = 7;
  if (recentTradeMedian && min) {
    const ratio = (min * 1) / recentTradeMedian; // 호가/실거래
    if (ratio <= 1.02) {
      valueGap = 15;
      reasons.push('호가가 실거래에 근접(거품 적음)');
    } else if (ratio <= 1.1) {
      valueGap = 11;
    } else {
      valueGap = 5;
      cautions.push('호가가 실거래 대비 높음(협상 필요)');
    }
  }
  bd.valueGap = valueGap;

  // ⑤ freshness (10) — 연식
  let freshness = 4;
  const y = c.elapsedYear;
  if (y != null) {
    if (y <= 10) {
      freshness = 10;
      reasons.push(`준신축(${y}년차)`);
    } else if (y <= 20) freshness = 7;
    else if (y >= 30) {
      freshness = 6; // 재건축 연한 가점
      reasons.push(`재건축 연한 접근(${y}년차)`);
    } else freshness = 4;
  }
  bd.freshness = freshness;

  // ⑥ selection (5)
  const selection = Math.min(5, c.inBudgetCount);
  bd.selection = selection;

  const score = budgetFit + liquidity + tier + valueGap + freshness + selection;
  return {
    complexNo: c.complexNo,
    name: c.name,
    gu: c.gu,
    dong: c.dong,
    score,
    grade: gradeOf(score),
    minDealPrice: min,
    household: c.household,
    elapsedYear: c.elapsedYear,
    inBudgetCount: c.inBudgetCount,
    reasons,
    cautions,
    breakdown: bd,
  };
}

export function rankCandidates(
  candidates: ComplexCandidate[],
  tradeMedianByName: Map<string, number>,
  nowBudget: number | null,
  easedBudget: number | null,
): Recommendation[] {
  return candidates
    .map((c) =>
      scoreCandidate({
        candidate: c,
        recentTradeMedian: tradeMedianByName.get(c.name) ?? null,
        nowBudgetManwon: nowBudget,
        easedBudgetManwon: easedBudget,
      }),
    )
    .sort((a, b) => b.score - a.score);
}
