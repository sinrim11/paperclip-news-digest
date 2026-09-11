/**
 * LocaleMap — 단지 반경 입지도 (2026-08-29, 카드뉴스 도식의 웹 이식).
 *
 * 분양 홍보물의 표준 표현인 '동심원 반경 + 방위별 아이콘'을 실좌표로 재현한다.
 * 배치는 임의가 아니라 단지 기준 실제 방위·거리이고, 같은 방향에 겹치면 각도만 벌린다
 * (거리는 유지 — 반경 링이 의미를 잃으면 안 되므로).
 */

import type { NearbyPlace } from '@/lib/nearby';

const S = 260; // 지도 한 변(px)
const C = S / 2;
const LIMIT_M = 1600; // 이보다 먼 시설은 표시하지 않는다

export function LocaleMap({ lat, lng, places }: { lat: number; lng: number; places: NearbyPlace[] }) {
  const near = places.filter((n) => n.distance <= LIMIT_M);
  if (!near.length) return null;

  // 스케일은 고정이 아니라 가장 먼 시설에 맞춘다(2026-09-11). 1.6km 고정이면 POI가 7~568m에
  // 몰린 단지(역세권일수록 그렇다)의 아이콘이 중심에 겹쳐 '단지' 라벨까지 가린다.
  const farthest = Math.max(...near.map((n) => n.distance));
  const maxM = Math.max(400, Math.ceil((farthest * 1.15) / 200) * 200);
  const px = (m: number) => (m / maxM) * (C - 26);
  const ringM = [Math.round(maxM / 3 / 50) * 50, Math.round((maxM * 2) / 3 / 50) * 50, maxM];

  const latRad = (lat * Math.PI) / 180;
  const used: number[] = [];
  const dots = near.map((n) => {
    const dx = (n.lng - lng) * Math.cos(latRad) * 111_320;
    const dy = (n.lat - lat) * 110_540;
    // 중심 마커와 '단지' 라벨을 피하는 최소 반지름
    const r = Math.max(42, px(Math.min(Math.max(1, Math.hypot(dx, dy)), maxM)));
    let ang = Math.atan2(dy, dx);
    // 각도가 아니라 실제 픽셀 거리로 겹침을 본다 — 안쪽 아이콘은 각도만 벌려선 안 떨어진다
    let guard = 0;
    while (guard++ < 24 && used.some((u) => Math.hypot((Math.cos(ang) - Math.cos(u)) * r, (Math.sin(ang) - Math.sin(u)) * r) < 30)) ang += 0.5;
    used.push(ang);
    return { n, x: C + Math.cos(ang) * r, y: C - Math.sin(ang) * r }; // SVG는 y축이 아래로 증가
  });

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-bold">🗺 걸어서 닿는 거리</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        {`점선은 안쪽부터 반경 ${ringM[0]}m·${ringM[1]}m(진한 선)·${ringM[2]}m`} · 아이콘 위치는 단지 기준 실제 방위입니다.
      </p>
      <div className="mt-3 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <svg
          width={S}
          height={S}
          viewBox={`0 0 ${S} ${S}`}
          className="shrink-0 rounded-xl bg-gray-50"
          role="img"
          aria-label={`단지 반경 입지도 — ${near.map((n) => `${n.kind} ${n.name} ${n.distance}m`).join(', ')}`}
        >
          {ringM.map((m) => (
            <circle
              key={m}
              cx={C}
              cy={C}
              r={px(m)}
              fill="none"
              stroke={m === ringM[1] ? '#94A3B8' : '#CBD5E1'}
              strokeWidth={m === ringM[1] ? 1.5 : 1}
              strokeDasharray="5 5"
            />
          ))}
          <circle cx={C} cy={C} r={11} fill="#2563EB" />
          <text x={C} y={C + 30} fontSize="12" textAnchor="middle" fill="#1D4ED8" fontWeight="700">단지</text>
          {dots.map(({ n, x, y }) => (
            <text key={n.kind} x={x} y={y + 8} fontSize="24" textAnchor="middle">{n.icon}</text>
          ))}
        </svg>

        <ul className="w-full min-w-0 space-y-2">
          {near.map((n) => (
            <li key={n.kind} className="flex items-baseline gap-2.5 text-sm">
              <span className="shrink-0">{n.icon}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{n.name}</span>
              <span className="shrink-0 tabular-nums text-gray-500">
                {n.distance}m · 도보 {Math.max(1, Math.round(n.distance / 80))}분
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
