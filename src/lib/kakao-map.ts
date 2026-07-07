/**
 * kakao-map.ts — 카카오 로컬/모빌리티 REST 클라이언트 (통근·상권 실데이터).
 *
 * 참조 구현: card-news-generator의 KakaoMapService.java(길찾기·카테고리·SW8 최근접역)
 *   + venueContext.mjs(주소→좌표 address.json → keyword.json 폴백). 동일 패턴 이식:
 *   Authorization: KakaoAK {KAKAO_REST_API_KEY} · 8s 타임아웃 · best-effort(실패 시 null/[] — throw 금지).
 * 카테고리 코드: SW8 지하철역 · CS2 편의점 · MT1 대형마트 · FD6 음식점 · CE7 카페 · HP8 병원 · PM9 약국 · AC5 학원 · SC4 학교
 */

const KEY = () => process.env.KAKAO_REST_API_KEY ?? '';
export const kakaoEnabled = () => Boolean(KEY());

async function kakaoGet(url: string, params: Record<string, string | number>): Promise<any | null> {
  if (!kakaoEnabled()) return null;
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const res = await fetch(u, { headers: { Authorization: `KakaoAK ${KEY()}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 주소/장소명 → 좌표. address.json 우선, keyword.json 폴백 (venueContext.mjs 패턴) */
export async function geocode(query: string): Promise<{ lat: number; lng: number; label: string; source: string } | null> {
  const q = query.trim();
  if (!q) return null;
  const byAddr = await kakaoGet('https://dapi.kakao.com/v2/local/search/address.json', { query: q });
  const a = byAddr?.documents?.[0];
  if (a?.x && a?.y) return { lat: Number(a.y), lng: Number(a.x), label: a.address_name ?? q, source: 'kakao-address' };
  const byKw = await kakaoGet('https://dapi.kakao.com/v2/local/search/keyword.json', { query: q, size: 3 });
  const k = byKw?.documents?.[0];
  if (k?.x && k?.y) return { lat: Number(k.y), lng: Number(k.x), label: k.place_name ?? q, source: 'kakao-keyword' };
  return null;
}

/** 카테고리 검색 — 반경 내 총 개수(meta.total_count) + 최근접 목록 */
export async function searchCategory(lat: number, lng: number, code: string, radius: number, size = 5): Promise<{ total: number; places: Array<{ name: string; distanceM: number }> } | null> {
  const data = await kakaoGet('https://dapi.kakao.com/v2/local/search/category.json', {
    category_group_code: code, x: lng, y: lat, radius, size, sort: 'distance',
  });
  if (!data) return null;
  return {
    total: Number(data.meta?.total_count ?? 0),
    places: (data.documents ?? []).map((d: any) => ({ name: String(d.place_name ?? ''), distanceM: Number(d.distance ?? 0) })),
  };
}

/** 최근접 지하철역(SW8, 실제 역 출입구 기준 거리) — KakaoMapService.findNearestSubwayStation 패턴 */
export async function nearestSubwayKakao(lat: number, lng: number): Promise<{ name: string; distanceM: number } | null> {
  const r = await searchCategory(lat, lng, 'SW8', 2000, 1);
  const p = r?.places?.[0];
  if (!p?.name) return null;
  // "신대방삼거리역 7호선" → "신대방삼거리" (지점 괄호·노선 접미 제거)
  const name = p.name.replace(/\s*\(.*\)$/, '').replace(/역(\s.+)?$/, '').trim();
  return { name, distanceM: p.distanceM };
}

/** 자차 실경로 소요(분)·거리(km) — Kakao Mobility Directions v1 (KakaoMapService.getDrivingMinutes 패턴) */
export async function drivingRoute(fromLat: number, fromLng: number, toLat: number, toLng: number): Promise<{ minutes: number; km: number } | null> {
  const data = await kakaoGet('https://apis-navi.kakaomobility.com/v1/directions', {
    origin: `${fromLng},${fromLat}`,
    destination: `${toLng},${toLat}`,
  });
  const sum = data?.routes?.[0]?.summary;
  if (!sum?.duration) return null;
  return { minutes: Math.round(sum.duration / 60), km: +(sum.distance / 1000).toFixed(1) };
}

/** 상권 카테고리 배치 정의(코드·반경·라벨) — refresh 스크립트·점수 공용 */
export const AMENITY_CATS: Array<{ key: string; code: string; radius: number; label: string }> = [
  { key: 'convenience', code: 'CS2', radius: 500, label: '편의점' },
  { key: 'mart', code: 'MT1', radius: 1000, label: '대형마트' },
  { key: 'food', code: 'FD6', radius: 500, label: '음식점' },
  { key: 'cafe', code: 'CE7', radius: 500, label: '카페' },
  { key: 'hospital', code: 'HP8', radius: 1000, label: '병원' },
  { key: 'pharmacy', code: 'PM9', radius: 500, label: '약국' },
  { key: 'academy', code: 'AC5', radius: 1000, label: '학원' },
  { key: 'school', code: 'SC4', radius: 1000, label: '학교' },
];
