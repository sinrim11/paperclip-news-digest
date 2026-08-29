/**
 * nearby.ts — 단지 반경 생활 인프라 조회 (2026-08-29, 카드뉴스·웹 공용).
 *
 * 카드뉴스 입지도에만 있던 조회를 웹 단지 프로필에서도 쓰려고 분리했다.
 * 카카오 로컬 카테고리 검색으로 종류별 최근접 1곳만 잡고, complexNo로 캐시한다
 * (한 번 잡힌 지하철역은 잘 바뀌지 않으므로 재조회할 이유가 없다).
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface NearbyPlace {
  kind: string;
  icon: string;
  name: string;
  distance: number; // m
  lat: number;
  lng: number;
}

const CATEGORIES: Array<{ code: string; kind: string; icon: string }> = [
  { code: 'SW8', kind: '지하철', icon: '🚇' },
  { code: 'SC4', kind: '학교', icon: '🏫' },
  { code: 'MT1', kind: '마트', icon: '🛒' },
  { code: 'HP8', kind: '병원', icon: '🏥' },
];

const CACHE = join(process.cwd(), 'output', 'locale-cache.json');

function readCache(): Record<string, NearbyPlace[]> {
  try {
    return JSON.parse(readFileSync(CACHE, 'utf-8'));
  } catch {
    return {};
  }
}

/** 캐시된 값만 — 페이지 렌더를 외부 API에 묶지 않으려는 경로. */
export function cachedNearby(cacheKey: string): NearbyPlace[] | null {
  return readCache()[cacheKey] ?? null;
}

export async function fetchNearby(lat: number, lng: number, cacheKey: string): Promise<NearbyPlace[]> {
  const cache = readCache();
  if (cache[cacheKey]) return cache[cacheKey];
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return [];
  const out: NearbyPlace[] = [];
  for (const c of CATEGORIES) {
    try {
      const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${c.code}&x=${lng}&y=${lat}&radius=2000&sort=distance&size=1`;
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { documents?: Array<{ place_name: string; distance: string; x: string; y: string }> };
      const d = j.documents?.[0];
      if (d) out.push({ kind: c.kind, icon: c.icon, name: d.place_name, distance: Number(d.distance), lat: Number(d.y), lng: Number(d.x) });
    } catch {
      /* 개별 실패는 무시 — 입지 정보는 부가 정보라 없으면 없는 대로 */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  cache[cacheKey] = out;
  try {
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  } catch {
    /* 캐시 실패 무시 */
  }
  return out;
}
