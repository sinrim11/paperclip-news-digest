/**
 * 지역 호재(모멘텀) 로더 — config/momentum-factors.json 소비 (2-A).
 * 확실성 3등급: 확정(착공·개통일 확정) / 진행(승인·부분 착공) / 구상(발표만).
 * 구상 단계는 점수·추천 사유 반영 금지 — 단지 프로필 표시만(호출측 책임이지만
 * recoFactorsFor()는 아예 확정·진행만 반환해 실수를 차단).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export type Certainty = '확정' | '진행' | '구상';

export interface MomentumFactor {
  id: string;
  type: string;
  title: string;
  detail: string;
  certainty: Certainty;
  expected: string;
  regions: Array<{ gu: string; dongs?: string[] }>;
  verifiedAt: string;
  sourceUrls: string[];
}

interface MomentumFile {
  asOf: string;
  factors: MomentumFactor[];
}

let cache: MomentumFile | null = null;

function load(): MomentumFile {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(join(process.cwd(), 'config', 'momentum-factors.json'), 'utf-8')) as MomentumFile;
  } catch {
    cache = { asOf: '', factors: [] };
  }
  return cache;
}

const CERT_ORDER: Record<Certainty, number> = { 확정: 0, 진행: 1, 구상: 2 };
/** 법정동 'N가' 접미 정규화 — tiers.tierOf와 동일 규칙 */
const normDong = (d: string) => d.replace(/\d+가$/, '');

/** 구(+동)에 해당하는 호재 전부 — 확실성 순 정렬. 동 지정 팩터는 동 일치 시에만. */
export function momentumFor(gu: string, dong?: string): MomentumFactor[] {
  const out = load().factors.filter((f) =>
    f.regions.some((r) => r.gu === gu && (!r.dongs || (dong != null && r.dongs.some((d) => normDong(d) === normDong(dong))))),
  );
  return out.sort((a, b) => CERT_ORDER[a.certainty] - CERT_ORDER[b.certainty]);
}

/** 추천 사유 표기용 — 확정·진행만(구상은 점수·사유 반영 금지 원칙). */
export function recoFactorsFor(gu: string, dong?: string): MomentumFactor[] {
  return momentumFor(gu, dong).filter((f) => f.certainty !== '구상');
}

export function momentumAsOf(): string {
  return load().asOf;
}

/** 전체 팩터(확실성 순) — 카드뉴스 브리핑 시리즈 등 요약 소비용. */
export function allFactors(): MomentumFactor[] {
  return [...load().factors].sort((a, b) => CERT_ORDER[a.certainty] - CERT_ORDER[b.certainty]);
}
