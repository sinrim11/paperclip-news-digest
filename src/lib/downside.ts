/**
 * 하방 경고 플래그(2-B) — "2~10년 상승 기미 없음"을 검증 불가한 예측 대신
 * 관측 가능한 신호로 치환. 각 플래그는 원천 수치를 evidence로 동반(가드레일 3).
 *
 * Phase 0 확정: 플래그 2개 이상 → 일일 추천 제외 + 사유 로그 / 1개 → 유의점 표시.
 * 내부 지표(거래량 추세·전세수요) 선행 — 외부 지표(입주물량·미분양·인구)는
 * 공식 출처 확보 시 이 모듈에 증분 추가(보류 항목, 최종 보고 기재).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface DownsideFlag {
  key: string;
  label: string; // 신호명 + 원천 수치(evidence)
}

export interface DownsideConfig {
  enabled?: boolean;
  excludeThreshold: number; // 이 개수 이상이면 추천 제외
  tradeDropPct: number; // 후반기 거래량이 전반기 대비 이 % 이상 감소하면 플래그
  minPriorTrades: number; // 전반기 최소 거래건수(표본 미달이면 추세 판정 안 함)
  weakJeonsePct: number; // 전세가율이 이 값 미만이면 실거주 수요 약함 플래그
  reportingLagDays?: number; // 실거래 신고기한(계약 후 30일) — 최근 N일은 과소집계라 추세 비교에서 제외
}

export const DEFAULT_DOWNSIDE: DownsideConfig = {
  enabled: true,
  excludeThreshold: 2,
  tradeDropPct: 50,
  minPriorTrades: 6,
  weakJeonsePct: 55,
  reportingLagDays: 30,
};

/**
 * 거래량 추세 급감 — 신고 지연분(최근 reportingLagDays)을 제외한 창을 반으로 갈라 전/후반 비교.
 * 최근 30일은 신고기한 미도래 계약이 빠져 있어 그대로 쓰면 '급감' 오탐이 난다.
 */
export function tradeTrendFlag(
  tradeMs: number[],
  lookbackDays: number,
  nowMs: number,
  cfg: DownsideConfig,
): DownsideFlag | null {
  const lagMs = (cfg.reportingLagDays ?? 30) * 86_400_000;
  const windowMs = lookbackDays * 86_400_000 - lagMs;
  if (windowMs <= 0) return null;
  const halfMs = windowMs / 2;
  const cutRecent = nowMs - lagMs; // 이 시점 이후 거래는 집계 제외(신고 미완)
  const cutMid = cutRecent - halfMs;
  const firstHalf = tradeMs.filter((ms) => ms <= cutMid).length;
  const secondHalf = tradeMs.filter((ms) => ms > cutMid && ms <= cutRecent).length;
  if (firstHalf < cfg.minPriorTrades) return null; // 표본 부족 — 추세 판정 불가
  const dropPct = ((firstHalf - secondHalf) / firstHalf) * 100;
  if (dropPct < cfg.tradeDropPct) return null;
  const halfDays = Math.round(halfMs / 86_400_000);
  return {
    key: 'trade-drop',
    label: `거래량 급감 — 직전 ${halfDays}일 ${firstHalf}건 → 최근 ${halfDays}일 ${secondHalf}건(−${Math.round(dropPct)}%, 국토부 실거래 · 신고지연 ${cfg.reportingLagDays ?? 30}일 보정)`,
  };
}

/** 전세가율 과소 — 실거주(임차) 수요가 매매가를 받치지 못하는 신호. */
export function jeonseWeakFlag(jeonseRatioPct: number | null, jeonseSamples: number, cfg: DownsideConfig): DownsideFlag | null {
  if (jeonseRatioPct == null || jeonseSamples < 2) return null; // 표본 부족 — 판정 안 함
  if (jeonseRatioPct >= cfg.weakJeonsePct) return null;
  return {
    key: 'weak-jeonse',
    label: `전세가율 ${jeonseRatioPct}%(<${cfg.weakJeonsePct}%, 계약 ${jeonseSamples}건) — 실거주 수요 약함·하락 방어력 낮음`,
  };
}

/* ── 공급 리스크(외부 지표, 2026-08-11) — 월간 supply-risk.sh가 생성한 config/supply-risk.json 소비 ── */

interface SupplyRegion {
  region: string;
  unsold?: { count?: number; trend?: string; asOfMonth?: string };
  supply12m?: { units?: number };
  riskLevel?: string;
  sourceUrls?: string[];
}
let _supplyCache: SupplyRegion[] | null | undefined;

function loadSupplyRegions(): SupplyRegion[] | null {
  if (_supplyCache !== undefined) return _supplyCache;
  try {
    const j = JSON.parse(readFileSync(join(process.cwd(), 'config', 'supply-risk.json'), 'utf-8')) as { regions?: SupplyRegion[] };
    _supplyCache = j.regions ?? null;
  } catch {
    _supplyCache = null;
  }
  return _supplyCache;
}

/** 지역(구·시) 공급 리스크 플래그 — riskLevel=high일 때만 1플래그(미분양 증가+입주물량 부담, 출처 동반). */
export function supplyRiskFlag(gu: string): DownsideFlag | null {
  const regions = loadSupplyRegions();
  if (!regions) return null;
  const e = regions.find((r) => gu.startsWith(r.region.replace(/시$/, '')));
  if (!e || e.riskLevel !== 'high') return null;
  const src = e.sourceUrls?.[0]?.replace(/^https?:\/\//, '').split('/')[0] ?? '공식 통계';
  return {
    key: 'supply-risk',
    label: `공급 리스크(${e.region}) — 미분양 ${e.unsold?.count ?? '?'}세대(${e.unsold?.trend ?? '?'}, ${e.unsold?.asOfMonth ?? ''}) · 12개월 입주 ${e.supply12m?.units?.toLocaleString() ?? '?'}세대 (${src})`,
  };
}

/** 단지의 하방 플래그 일괄 판정. */
export function downsideFlags(
  input: { tradeMs: number[]; lookbackDays: number; nowMs: number; jeonseRatioPct: number | null; jeonseSamples: number },
  cfg: DownsideConfig,
): DownsideFlag[] {
  if (cfg.enabled === false) return [];
  const flags: DownsideFlag[] = [];
  const t = tradeTrendFlag(input.tradeMs, input.lookbackDays, input.nowMs, cfg);
  if (t) flags.push(t);
  const j = jeonseWeakFlag(input.jeonseRatioPct, input.jeonseSamples, cfg);
  if (j) flags.push(j);
  return flags;
}
