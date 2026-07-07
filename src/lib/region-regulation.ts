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

export function regulationAsOf(): string {
  return load().asOf;
}
