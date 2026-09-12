/**
 * 지역별 규제 상태 로더 — config/region-regulation.json 소비.
 * 지역 확대의 선행 게이트(가드레일 1): 테이블에 없거나 unverified인 지역은 추천 금지.
 * 구/시 이름은 tiers.ts LAWD_GU 값과 동일 표기("안양 만안구" 등).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface RegionRegulation {
  status: 'regulated' | 'non-regulated' | 'unverified';
  landPermit: boolean;
  landPermitUntil?: string;
  speculationZone?: boolean;
  adjusted?: boolean;
  gapInvest: boolean;
  label: string;
  note?: string;
  verifiedAt: string;
  sourceUrls: string[];
}

interface RegulationFile {
  asOf: string;
  sources: Array<{ title: string; url: string; date: string | null }>;
  groups: Array<{ name: string; regions: string[]; regulation: RegionRegulation }>;
}

const UNVERIFIED: RegionRegulation = {
  status: 'unverified',
  landPermit: false,
  gapInvest: false,
  label: '규제 상태 미검증 — 추천 금지(테이블 미등재)',
  verifiedAt: '',
  sourceUrls: [],
};

let cache: { map: Map<string, RegionRegulation>; asOf: string } | null = null;

function load(): { map: Map<string, RegionRegulation>; asOf: string } {
  if (cache) return cache;
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), 'config', 'region-regulation.json'), 'utf-8'),
  ) as RegulationFile;
  const map = new Map<string, RegionRegulation>();
  for (const g of raw.groups) for (const r of g.regions) map.set(r, g.regulation);
  cache = { map, asOf: raw.asOf };
  return cache;
}

/** 구/시 이름 → 규제 상태. 테이블 미등재는 unverified(추천 금지) 반환. */
export function regulationOf(gu: string): RegionRegulation {
  return load().map.get(gu) ?? UNVERIFIED;
}

/** 갭투자(전세승계 즉시임대) 가능한 비규제 지역 집합 — 구 tiers.NON_REGULATED_GU 대체. */
export function nonRegulatedGus(): Set<string> {
  const s = new Set<string>();
  for (const [gu, reg] of load().map) if (reg.status === 'non-regulated' && reg.gapInvest) s.add(gu);
  return s;
}

/**
 * 만료 임박 경고(2026-09-12) — 토지거래허가구역 지정은 기한이 있다. 기한이 지나면 해제되거나
 * 연장되는데, 어느 쪽이든 **추천 로직이 바뀐다**(해제되면 갭투자가 가능해진다).
 *
 * 왜 필요한가: region-regulation.json이 2026-07-08 이후 두 달 넘게 그대로였다. 레이더가
 * "토허구역 지정기한 연장 여부: unverifiable"을 9/8·9/9에 올렸지만 아무도 처리하지 않았다.
 * 자동 적용을 금지해 안전을 얻었지만, 사람이 보지 않으면 그건 안전이 아니라 방치다.
 * 기한이 지나면 조용히 틀린 정보가 되므로 스스로 알리게 한다.
 */
export function expiringLandPermits(withinDays = 60, now = new Date()): Array<{ name: string; until: string; daysLeft: number; regionCount: number }> {
  const raw = loadRaw();
  if (!raw) return [];
  const out: Array<{ name: string; until: string; daysLeft: number; regionCount: number }> = [];
  for (const g of raw.groups) {
    const until = g.regulation.landPermitUntil;
    if (!until) continue;
    const d = Math.ceil((new Date(`${until}T23:59:59+09:00`).getTime() - now.getTime()) / 86_400_000);
    if (d <= withinDays) out.push({ name: g.name, until, daysLeft: d, regionCount: g.regions.length });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

let _raw: RegulationFile | null | undefined;
function loadRaw(): RegulationFile | null {
  if (_raw !== undefined) return _raw ?? null;
  try { _raw = JSON.parse(readFileSync(join(process.cwd(), 'config', 'region-regulation.json'), 'utf-8')) as RegulationFile; }
  catch { _raw = null; }
  return _raw ?? null;
}

export function regulationAsOf(): string {
  return load().asOf;
}
