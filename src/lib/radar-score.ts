/**
 * radar-score.ts — 공유용 객관 레이더 지수(100점) 단일 소스.
 *   개인 예산·통근 기준 없이 공개 데이터만: 실거래갭 40 · 유동성 30(세대15+매물15) · 연식·재건축 15 · 전세가율 15.
 *   소비처: scripts/gen-cardnews.ts(인스타 카드) · /complex/[complexNo](단지 상세).
 */

export interface RadarInput {
  household: number;
  elapsedYear: number | null;
  far: number | null; // 용적률 %
  dealArticles: number;
  gapPct: number | null; // (최저호가 − 실거래중간)/실거래중간 ×100
  jeonseRatioPct: number | null;
  tradeCount: number;
}

export interface RadarResult {
  score: number;
  parts: { gap: number; liq: number; fresh: number; jeonse: number };
  facts: string[]; // 수치 기반 객관 서술
}

export const RADAR_PART_META = [
  { key: 'gap', label: '실거래갭', max: 40, color: '#16A34A' },
  { key: 'liq', label: '유동성', max: 30, color: '#0EA5E9' },
  { key: 'fresh', label: '연식·재건축', max: 15, color: '#F59E0B' },
  { key: 'jeonse', label: '전세가율', max: 15, color: '#7C3AED' },
] as const;

export function radarScore(p: RadarInput): RadarResult {
  // 실거래갭(40): 호가가 실거래에 가깝거나 낮을수록 — 거품 판정
  let gap = 12;
  if (p.gapPct != null) {
    gap = p.gapPct <= -2 ? 40 : p.gapPct <= 2 ? 34 : p.gapPct <= 6 ? 26 : p.gapPct <= 12 ? 16 : 8;
  }
  // 유동성(30): 세대수 15 + 매매 매물 15
  const liq = Math.round(Math.min(15, (p.household / 1500) * 15) + Math.min(15, (p.dealArticles / 15) * 15));
  // 연식·재건축(15): 준신축 만점 · 30년↑은 용적률(사업성) 차등
  const y = p.elapsedYear;
  let fresh: number;
  if (y == null) fresh = 8;
  else if (y <= 10) fresh = 15;
  else if (y <= 20) fresh = 10;
  else if (y >= 30) fresh = p.far == null ? 8 : p.far <= 180 ? 15 : p.far <= 230 ? 11 : 6;
  else fresh = 6;
  // 전세가율(15)
  const jr = p.jeonseRatioPct;
  const jeonse = jr == null ? 6 : jr >= 80 ? 15 : jr >= 70 ? 12 : jr >= 60 ? 8 : 4;

  const facts: string[] = [];
  if (p.gapPct != null && p.gapPct <= 0) facts.push(`최저 호가가 최근 실거래보다 ${Math.abs(p.gapPct).toFixed(1)}% 낮음`);
  else if (p.gapPct != null && p.gapPct <= 2) facts.push(`호가가 실거래에 근접(+${p.gapPct.toFixed(1)}% — 거품 적음)`);
  if (p.tradeCount >= 10) facts.push(`120일간 ${p.tradeCount}건 거래 — 시세 신뢰도·환금성 확보`);
  if (p.household >= 1000) facts.push(`${p.household.toLocaleString()}세대 대단지 — 시세 안정`);
  if (jr != null && jr >= 70) facts.push(`전세가율 ${jr}% — 실거주 수요 탄탄`);
  if (y != null && y >= 30) {
    if (p.far != null && p.far <= 180) facts.push(`${y}년차 · 용적률 ${Math.round(p.far)}% — 재건축 사업성 양호 구간`);
    else if (p.far != null && p.far > 230) facts.push(`${y}년차이나 용적률 ${Math.round(p.far)}% — 재건축 기대는 제한적`);
    else facts.push(`${y}년차 — 재건축 연한 진입 구간`);
  }
  if (y != null && y <= 10) facts.push(`준신축 ${y}년차`);

  return { score: gap + liq + fresh + jeonse, parts: { gap, liq, fresh, jeonse }, facts };
}
