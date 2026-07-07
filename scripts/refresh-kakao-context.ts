/**
 * refresh-kakao-context.ts — 단지별 카카오 실데이터 수집 → config/kakao-context.json
 *   ① SW8 최근접 지하철역(실 출입구 거리) ② 상권 8개 카테고리 반경 내 총 개수(meta.total_count)
 *   ③ 기본 출근지까지 자차 실경로 시간(Kakao Mobility Directions)
 * 참조: card-news-generator KakaoMapService.java 패턴. 콜 수: 단지당 10회 × 493 ≈ 4,930 (일 쿼터 내).
 * 실행: npx tsx scripts/refresh-kakao-context.ts [--all]  (기본: 기존 캐시에 없는 단지만 증분)
 * 주기: naver-sweep.sh 마지막 단계(주간) — 신규 단지 자동 보충.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { kakaoEnabled, nearestSubwayKakao, searchCategory, drivingRoute, AMENITY_CATS } from '../src/lib/kakao-map';
import { loadReaderFinances } from '../src/lib/tracker';
import { DEFAULT_WORK } from '../src/lib/commute';

const OUT = join(process.cwd(), 'config', 'kakao-context.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Entry { subway: { name: string; distanceM: number } | null; counts: Record<string, number>; driveMin: number | null; driveKm: number | null; at: string }
interface Cache { asOf: string; workKey: string; source: string; complexes: Record<string, Entry> }

(async () => {
  if (!kakaoEnabled()) { console.error('KAKAO_REST_API_KEY 미설정 — .env 확인'); process.exit(1); }
  const prisma = new PrismaClient();
  const all = process.argv.includes('--all');

  const fin = loadReaderFinances();
  const work = fin?.work ?? DEFAULT_WORK;
  const workKey = `${work.lat.toFixed(5)},${work.lng.toFixed(5)}`;

  let cache: Cache = { asOf: '', workKey, source: 'Kakao Local/Mobility API (dapi.kakao.com·apis-navi.kakaomobility.com)', complexes: {} };
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf-8')) as Cache;
    // 출근지가 바뀌면 driveMin 무효 → 전체 재수집(상권·역은 유지해도 되지만 단순화)
    if (prev.workKey === workKey) cache = prev;
    else console.log(`출근지 변경 감지(${prev.workKey} → ${workKey}) — 자차 경로 재수집`);
  } catch { /* 첫 실행 */ }

  const cands = await prisma.complexCandidate.findMany({ where: { lat: { not: null } }, select: { complexNo: true, name: true, gu: true, lat: true, lng: true } });
  const targets = all ? cands : cands.filter((c) => !cache.complexes[c.complexNo]);
  console.log(`카카오 컨텍스트: 대상 ${targets.length}/${cands.length} 단지 (증분=${!all}) · 출근지 ${work.label}`);

  let done = 0, fail = 0;
  for (const c of targets) {
    try {
      const subway = await nearestSubwayKakao(c.lat!, c.lng!);
      const counts: Record<string, number> = {};
      for (const cat of AMENITY_CATS) {
        const r = await searchCategory(c.lat!, c.lng!, cat.code, cat.radius, 1);
        counts[cat.key] = r?.total ?? 0;
        await sleep(120);
      }
      const drive = await drivingRoute(c.lat!, c.lng!, work.lat, work.lng);
      cache.complexes[c.complexNo] = { subway, counts, driveMin: drive?.minutes ?? null, driveKm: drive?.km ?? null, at: new Date().toISOString().slice(0, 10) };
      done++;
      if (done % 25 === 0) {
        console.log(`  [${done}/${targets.length}] ${c.gu} ${c.name}: 역 ${subway?.name ?? '?'} ${subway?.distanceM ?? '?'}m · 자차 ${drive?.minutes ?? '?'}분`);
        // 중간 저장(중단 대비)
        cache.asOf = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
        writeFileSync(OUT + '.tmp', JSON.stringify(cache)); renameSync(OUT + '.tmp', OUT);
      }
      await sleep(150);
    } catch (e) {
      fail++;
      console.log(`  · ${c.gu} ${c.name} 실패: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      await sleep(1000);
    }
  }

  cache.asOf = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  cache.workKey = workKey;
  writeFileSync(OUT + '.tmp', JSON.stringify(cache));
  renameSync(OUT + '.tmp', OUT);
  console.log(`완료 — 수집 ${done} · 실패 ${fail} · 캐시 총 ${Object.keys(cache.complexes).length}단지 → config/kakao-context.json`);
  await prisma.$disconnect();
})();
