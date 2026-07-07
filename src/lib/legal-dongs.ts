/**
 * 법정동코드 맵 로더 — 서울(config/seoul-legal-dongs.json) + 경기(config/legal-dongs-gyeonggi.json)를
 * 구/시 → 동 → 10자리 코드로 평탄화. backfill-coords·backfill-far 등 공유(1-B-iii).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const MAP_FILES = ['config/seoul-legal-dongs.json', 'config/legal-dongs-gyeonggi.json'];

let cache: Record<string, Record<string, string>> | null = null;

export function loadDongCodeMap(): Record<string, Record<string, string>> {
  if (cache) return cache;
  const byGu: Record<string, Record<string, string>> = {};
  for (const file of MAP_FILES) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(process.cwd(), file), 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const [k, province] of Object.entries(raw)) {
      if (k.startsWith('_') || typeof province !== 'object' || province == null) continue;
      for (const [gu, dongs] of Object.entries(province as Record<string, Record<string, string>>)) {
        byGu[gu] = { ...byGu[gu], ...dongs };
      }
    }
  }
  cache = byGu;
  return byGu;
}

export function dongCodeOf(gu: string, dong: string): string | null {
  return loadDongCodeMap()[gu]?.[dong] ?? null;
}
