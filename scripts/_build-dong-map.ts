/**
 * scripts/_build-dong-map.ts — 신규 지역 법정동 맵 생성 (2026-08-29, 일회성).
 *
 * 네이버 지역 API가 rate limit(429)이라 실조회가 막혀, 같은 코드 체계인
 * 법정동코드를 카카오 로컬 주소 API(b_code)로 확보한다.
 * 동일 체계 여부는 기존 맵(남양주·안양·의왕)과 교차 검증한 뒤에만 진행한다.
 *
 * 동 이름은 추측하지 않고 국토부 실거래(AptTrade)에 실제로 등장한 법정동만 대상으로 한다.
 * 실행: npx tsx scripts/_build-dong-map.ts        (검증만)
 *       npx tsx scripts/_build-dong-map.ts --write (config 병합)
 */

import { readFileSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { LAWD_GU } from '../src/lib/tiers';

const KEY = process.env.KAKAO_REST_API_KEY;
if (!KEY) throw new Error('KAKAO_REST_API_KEY 없음');
const prisma = new PrismaClient();
const MAP_PATH = 'config/legal-dongs-gyeonggi.json';
const NEW_LAWD = ['41290', '41210', '41450', '41310', '41131', '41133', '41135', '41465', '41463', '41117'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 카카오 주소 검색 → 법정동코드. 시군구명은 코드 접두 검증에 쓴다(동명이동 오매칭 차단). */
async function bCodeOf(query: string, lawdPrefix: string): Promise<string | null> {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as { documents?: Array<{ address?: { b_code?: string; address_name?: string } }> };
  for (const d of j.documents ?? []) {
    const b = d.address?.b_code;
    if (b && b.startsWith(lawdPrefix) && b.length === 10) return b;
  }
  return null;
}

async function main() {
  const write = process.argv.includes('--write');

  // ── 0. 체계 동일성 교차 검증 — 기존 맵의 알려진 코드와 카카오 b_code 대조 ──
  const existing = JSON.parse(readFileSync(MAP_PATH, 'utf-8')) as Record<string, Record<string, Record<string, string>>>;
  const checks: Array<[string, string, string]> = [
    ['경기도 남양주시 호평동', '41360', existing['경기도']['남양주시']['호평동']],
    ['경기도 안양시 동안구 평촌동', '41173', existing['경기도']['안양 동안구']['평촌동']],
    ['경기도 의왕시 포일동', '41430', existing['경기도']['의왕시']['포일동']],
  ];
  console.log('=== 코드 체계 교차 검증 (네이버 cortarNo vs 카카오 b_code) ===');
  for (const [q, prefix, known] of checks) {
    const got = await bCodeOf(q, prefix);
    const ok = got === known;
    console.log(`  ${ok ? '✅' : '❌'} ${q.split(' ').pop()}: 기존 ${known} / 카카오 ${got}`);
    if (!ok) throw new Error('코드 체계 불일치 — 중단(잘못된 코드를 스윕에 넣으면 조용히 0단지가 된다)');
    await sleep(200);
  }

  // ── 1. 대상 동 목록 — 실거래에 실제 등장한 법정동만 ──
  const rows = await prisma.aptTrade.groupBy({
    by: ['lawdCd', 'dong'],
    where: { lawdCd: { in: NEW_LAWD }, dealDate: { gte: new Date(Date.now() - 180 * 86_400_000) } },
    _count: { _all: true },
  });
  console.log(`\n=== 법정동코드 조회 (실거래 등장 ${rows.length}개 동) ===`);

  const out: Record<string, Record<string, string>> = {};
  let ok = 0;
  const failed: string[] = [];
  for (const r of rows) {
    const gu = LAWD_GU[r.lawdCd];
    // 카카오 질의는 실제 행정명 기준("안양 동안구" 같은 내부 표기를 시 단위로 환원)
    const siGu = gu.includes(' ') ? `${gu.split(' ')[0]}시 ${gu.split(' ')[1]}` : gu;
    const code = await bCodeOf(`경기도 ${siGu} ${r.dong}`, r.lawdCd);
    if (code) {
      (out[gu] ??= {})[r.dong] = code;
      ok++;
    } else {
      failed.push(`${gu} ${r.dong}`);
    }
    await sleep(120); // 카카오 쿼터 보호
  }
  for (const [gu, dongs] of Object.entries(out)) {
    const sorted = Object.entries(dongs).sort((a, b) => a[1].localeCompare(b[1]));
    console.log(`  ${gu} (${sorted.length}): ${sorted.map(([n, c]) => `${n}=${c.slice(5, 8)}`).join(' ')}`);
  }
  console.log(`\n성공 ${ok} · 실패 ${failed.length}${failed.length ? ' — ' + failed.join(', ') : ''}`);

  if (!write) {
    console.log('\n(검증 모드 — 병합하려면 --write)');
    return;
  }
  existing['경기도'] = { ...existing['경기도'], ...out };
  existing['_comment'] = String(existing['_comment'] ?? '') +
    ' 강남권 1시간 10개 시·구는 2026-08-29 추가 — 네이버 API 429로 실조회가 막혀 동일 체계인 카카오 b_code로 확보(기존 3개 지역 코드와 교차 검증 통과).';
  writeFileSync(MAP_PATH, JSON.stringify(existing, null, 2) + '\n');
  console.log(`\n✅ ${MAP_PATH} 병합 완료`);
}

main().catch((e) => { console.error('fatal:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
