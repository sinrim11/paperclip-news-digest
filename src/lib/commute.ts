/**
 * commute.ts — 출근지 통근성·상권 점수(결정적 근사 모델).
 *
 * 데이터: config/subway-stations.json (수도권 627역·23노선, 카카오 좌표 기반 공개셋
 *   github.com/stripe2933/SeoulMetropolitanSubway + 신림선 수동 보정)
 * 통근 추정: 도보(직선×1.3, 80m/분) + 대기 4분 + 지하철(역간 직선거리/33km/h) + 환승×6분 + 하차 도보.
 *   환승 횟수 = 노선 그래프 BFS(환승역 = 2개 이상 노선 보유역에서 자동 유도).
 * 자차 추정: 직선×1.35 / 시내 평균 27km/h.
 * ⚠️ 실시간 경로 API가 아닌 좌표 기반 근사 — 배차·급행·버스 미반영. 버스 의존 여부는 역 거리로 플래그.
 * 상권 점수: 역세권 등급 + 반경 1km 내 역 수 + 동일 동 아파트 세대 밀도(상권 형성 proxy) — 근사 지표.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

export interface Station { name: string; lines: string[]; lat: number; lng: number }
export interface WorkPlace { label: string; lat: number; lng: number }

/** 기본 출근지 — 전문건설회관(서울 동작구 신대방동 395-70. 카카오 지오코딩 실좌표) */
export const DEFAULT_WORK: WorkPlace = { label: '전문건설회관(신대방)', lat: 37.49199, lng: 126.92435 };

const LINE_LABEL: Record<string, string> = {
  '1': '1호선', '2': '2호선', '3': '3호선', '4': '4호선', '5': '5호선', '6': '6호선', '7': '7호선', '8': '8호선', '9': '9호선',
  A: '공항철도', B: '수인분당', E: '에버라인', G: '경의중앙', I: '인천1', I2: '인천2', K: '경춘', KK: '경강', KP: '김포골드',
  S: '신분당', SH: '서해', U: '의정부', W: '우이신설', SL: '신림선',
};
export const lineLabel = (l: string) => LINE_LABEL[l] ?? l;

let STATIONS: Station[] | null = null;
export function loadStations(): Station[] {
  if (!STATIONS) {
    const d = JSON.parse(readFileSync(join(process.cwd(), 'config', 'subway-stations.json'), 'utf-8'));
    STATIONS = (d.stations ?? []) as Station[];
  }
  return STATIONS!;
}

/** 하버사인 거리(km) */
export function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestStation(lat: number, lng: number): { st: Station; km: number } {
  return nearestStations(lat, lng, 1)[0];
}

/** 가까운 순 상위 k개 역 */
export function nearestStations(lat: number, lng: number, k = 3): Array<{ st: Station; km: number }> {
  const arr = loadStations().map((s) => ({ st: s, km: distKm(lat, lng, s.lat, s.lng) }));
  arr.sort((a, b) => a.km - b.km);
  return arr.slice(0, k);
}

/** 노선 그래프(노선=노드, 같은 역을 공유하면 간선) — 환승 횟수 BFS용. 1회 구축 캐시 */
let LINE_GRAPH: Map<string, Set<string>> | null = null;
function lineGraph(): Map<string, Set<string>> {
  if (LINE_GRAPH) return LINE_GRAPH;
  const g = new Map<string, Set<string>>();
  for (const s of loadStations()) {
    for (const a of s.lines) {
      if (!g.has(a)) g.set(a, new Set());
      for (const b of s.lines) if (a !== b) g.get(a)!.add(b);
    }
  }
  LINE_GRAPH = g;
  return g;
}

/** 출발노선집합→도착노선집합 최소 환승 횟수(같은 노선 공유 시 0) */
export function minTransfers(fromLines: string[], toLines: string[]): number {
  const toSet = new Set(toLines);
  if (fromLines.some((l) => toSet.has(l))) return 0;
  const g = lineGraph();
  const seen = new Set(fromLines);
  let frontier = [...fromLines], hops = 0;
  while (frontier.length && hops < 5) {
    hops++;
    const next: string[] = [];
    for (const l of frontier) for (const n of g.get(l) ?? []) {
      if (seen.has(n)) continue;
      if (toSet.has(n)) return hops;
      seen.add(n); next.push(n);
    }
    frontier = next;
  }
  return hops >= 5 ? 4 : hops; // 미도달 시 보수적 4회
}

/** 카카오 실데이터(refresh-kakao-context.ts가 채움) — 있으면 근사 대신 사용 */
export interface KakaoCtx {
  subway?: { name: string; distanceM: number } | null; // SW8 최근접역(실 출입구 거리)
  counts?: Record<string, number> | null; // AMENITY_CATS key → 반경 내 총 개수
  driveMin?: number | null; // Mobility 실경로 소요(분) — 기본 출근지 기준
  driveKm?: number | null;
}

export interface CommuteInfo {
  workLabel: string;
  straightKm: number; // 출근지 직선거리
  origin: { name: string; lines: string[]; walkMin: number; km: number }; // 단지 최근접역
  dest: { name: string; lines: string[]; walkMin: number }; // 출근지 최근접역
  transfers: number;
  railMin: number;
  totalMin: number; // 도보+대기+지하철+환승+하차도보
  driveMin: number;
  driveReal: boolean; // true=카카오 모빌리티 실경로, false=직선 근사
  busDependent: boolean; // 최근접역 1.2km 초과 → 버스 의존
  score: number; // 0~100
  basis: string;
  formula: string;
}

const WALK_SPEED = 80; // m/분
const ROUTE_FACTOR = 1.3; // 직선→실보행 보정
const RAIL_KMH = 33; // 역간 평균(정차 포함)
const TRANSFER_MIN = 6, WAIT_MIN = 4;
const DRIVE_FACTOR = 1.35, DRIVE_KMH = 27;

export function computeCommute(lat: number, lng: number, work: WorkPlace, kakao?: KakaoCtx | null): CommuteInfo {
  const straight = distKm(lat, lng, work.lat, work.lng);
  // 양끝 상위 3개 역 조합 중 총 소요 최소를 선택(최근접 고정 시 환승 과대평가 방지 — 예: 7호선 직통 대신 신림선 환승으로 계산되는 왜곡)
  // 카카오 SW8 실측역이 있으면 그 역을 출발 후보 1순위로 추가(좌표셋과 이름 매칭해 노선 확보, 거리는 실측값)
  const kakaoOrigin = kakao?.subway
    ? (() => {
        const st = loadStations().find((s) => s.name === kakao.subway!.name);
        return st ? { st, km: kakao.subway!.distanceM / 1000 } : null;
      })()
    : null;
  const oCands = nearestStations(lat, lng, 3);
  if (kakaoOrigin && !oCands.some((c) => c.st.name === kakaoOrigin.st.name)) oCands.unshift(kakaoOrigin);
  else if (kakaoOrigin) { const i = oCands.findIndex((c) => c.st.name === kakaoOrigin.st.name); if (i >= 0) oCands[i] = kakaoOrigin; }
  const dCands = nearestStations(work.lat, work.lng, 3);
  let best: { o: typeof oCands[0]; d: typeof dCands[0]; walkO: number; walkD: number; transfers: number; railMin: number; totalMin: number } | null = null;
  for (const oc of oCands) for (const dc of dCands) {
    const walkO = (oc.km * 1000 * ROUTE_FACTOR) / WALK_SPEED;
    const walkD = (dc.km * 1000 * ROUTE_FACTOR) / WALK_SPEED;
    const transfers = oc.st.name === dc.st.name ? 0 : minTransfers(oc.st.lines, dc.st.lines);
    const railDist = distKm(oc.st.lat, oc.st.lng, dc.st.lat, dc.st.lng);
    const railMin = oc.st.name === dc.st.name ? 0 : (railDist / RAIL_KMH) * 60 + 2; // +2 가감속 여유
    const totalMin = walkO + WAIT_MIN + railMin + transfers * TRANSFER_MIN + walkD;
    if (!best || totalMin < best.totalMin) best = { o: oc, d: dc, walkO, walkD, transfers, railMin, totalMin };
  }
  const { o, d, walkO, walkD, transfers, railMin, totalMin } = best!;
  // 자차: 카카오 모빌리티 실경로가 있으면 사용, 없으면 직선 근사
  const driveApprox = (straight * DRIVE_FACTOR) / DRIVE_KMH * 60 + 5; // +5 주차 여유
  const driveMin = kakao?.driveMin ?? driveApprox;
  const driveReal = kakao?.driveMin != null;
  const busDependent = o.km > 1.2;

  // 점수: 총 통근시간 밴드(25분=100, 75분=0 선형) − 도보 페널티(12분 초과분×2) − 환승 페널티(2회 초과분×6) − 버스의존 8
  let score = clamp(((75 - totalMin) / (75 - 25)) * 100);
  const walkPenalty = Math.max(0, walkO - 12) * 2;
  const trPenalty = Math.max(0, transfers - 2) * 6;
  const busPenalty = busDependent ? 8 : 0;
  score = clamp(score - walkPenalty - trPenalty - busPenalty);

  return {
    workLabel: work.label,
    straightKm: +straight.toFixed(1),
    origin: { name: o.st.name, lines: o.st.lines, walkMin: Math.round(walkO), km: +o.km.toFixed(2) },
    dest: { name: d.st.name, lines: d.st.lines, walkMin: Math.round(walkD) },
    transfers,
    railMin: Math.round(railMin),
    totalMin: Math.round(totalMin),
    driveMin: Math.round(driveMin),
    driveReal,
    busDependent,
    score: Math.round(score),
    formula: '점수 = clamp((75 − 총통근분) / (75 − 25) × 100) − 도보페널티(도보 12분 초과분×2) − 환승페널티(2회 초과분×6) − 버스의존 8; 총통근 = 도보 + 대기4 + 지하철(역간거리/33km/h) + 환승×6 + 하차도보',
    basis: `${o.st.name}(${o.st.lines.map(lineLabel).join('·')}) 도보 ${Math.round(walkO)}분${kakaoOrigin && o.st.name === kakaoOrigin.st.name ? '(카카오 실측)' : ''} → ${transfers}회 환승 → ${d.st.name} 하차 ${Math.round(walkD)}분 = 총 ~${Math.round(totalMin)}분(자차 ~${Math.round(driveMin)}분${driveReal ? '·카카오 실경로' : '·근사'})${busDependent ? ' · ⚠️ 역 1.2km 초과(버스 의존)' : ''} → ${Math.round(score)}점`,
  };
}

export interface AmenityInfo { score: number; basis: string; formula: string; stationsIn1km: number; nearestWalkMin: number }

/** 상권·생활 인프라 근사: 역세권 등급(60) + 1km 내 역 수(24) + 동일 동 아파트 세대밀도(16) */
export function computeAmenity(lat: number, lng: number, dongHouseholds: number): AmenityInfo {
  const o = nearestStation(lat, lng);
  const walkMin = Math.round((o.km * 1000 * ROUTE_FACTOR) / WALK_SPEED);
  let cnt = 0;
  for (const s of loadStations()) if (distKm(lat, lng, s.lat, s.lng) <= 1.0) cnt++;
  const stScore = walkMin <= 5 ? 60 : walkMin <= 10 ? 48 : walkMin <= 15 ? 34 : walkMin <= 25 ? 18 : 6;
  const cntScore = Math.min(24, cnt * 8);
  const hhScore = Math.min(16, (dongHouseholds / 8000) * 16);
  const score = Math.round(clamp(stScore + cntScore + hhScore));
  return {
    score,
    stationsIn1km: cnt,
    nearestWalkMin: walkMin,
    formula: '점수 = 역세권등급(도보 5분↓60·10분↓48·15분↓34·25분↓18·초과6) + 1km내 역수×8(최대24) + 동내 아파트 세대밀도(8천세대=만점16)',
    basis: `최근접 ${o.st.name} 도보 ${walkMin}분(${stScore}) + 1km 내 역 ${cnt}개(${cntScore}) + 동내 ${dongHouseholds.toLocaleString()}세대 밀도(${Math.round(hhScore)}) = ${score}점 (근사 지표 — 상가·학원가 실데이터 미연동)`,
  };
}

/** 상권 점수(카카오 로컬 실데이터) — 반경 내 실제 시설 수 기반. counts 키는 kakao-map.AMENITY_CATS 참조 */
export function computeAmenityKakao(counts: Record<string, number>, subwayDistanceM: number | null, lat: number, lng: number): AmenityInfo {
  const c = (k: string) => counts[k] ?? 0;
  const dM = subwayDistanceM ?? nearestStation(lat, lng).km * 1000;
  const walkMin = Math.round((dM * ROUTE_FACTOR) / WALK_SPEED);
  const stScore = dM <= 400 ? 30 : dM <= 800 ? 24 : dM <= 1200 ? 15 : dM <= 2000 ? 8 : 2;
  const parts: Array<[string, number, number]> = [ // [라벨(개수), 획득, 만점]
    [`편의점500m ${c('convenience')}`, Math.min(10, c('convenience') * 2.5), 10],
    [`대형마트1km ${c('mart')}`, c('mart') >= 1 ? 10 : 0, 10],
    [`음식점500m ${c('food')}`, Math.min(15, (c('food') / 40) * 15), 15],
    [`카페500m ${c('cafe')}`, Math.min(8, (c('cafe') / 15) * 8), 8],
    [`병원1km ${c('hospital')}`, Math.min(10, (c('hospital') / 10) * 10), 10],
    [`약국500m ${c('pharmacy')}`, Math.min(7, (c('pharmacy') / 3) * 7), 7],
    [`학원1km ${c('academy')}`, Math.min(5, (c('academy') / 20) * 5), 5],
    [`학교1km ${c('school')}`, Math.min(5, (c('school') / 3) * 5), 5],
  ];
  const score = Math.round(clamp(stScore + parts.reduce((s, [, v]) => s + v, 0)));
  let cnt = 0;
  for (const s of loadStations()) if (distKm(lat, lng, s.lat, s.lng) <= 1.0) cnt++;
  return {
    score,
    stationsIn1km: cnt,
    nearestWalkMin: walkMin,
    formula: '점수 = 역세권(실측거리 400m↓30·800m↓24·1.2km↓15·2km↓8·초과2) + 편의점(×2.5, 최대10) + 대형마트(1개+ 10) + 음식점(40개=15) + 카페(15개=8) + 병원(10개=10) + 약국(3개=7) + 학원(20개=5) + 학교(3개=5)',
    basis: `역 ${Math.round(dM)}m(${stScore}) + ${parts.map(([l, v]) => `${l}(${Math.round(v)})`).join(' + ')} = ${score}점 (카카오 로컬 API 실측 — dapi.kakao.com)`,
  };
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
