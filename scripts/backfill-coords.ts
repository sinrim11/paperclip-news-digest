/**
 * backfill-coords.ts — ComplexCandidate 좌표(lat/lng) 백필.
 *   new.land.naver.com/api/regions/complexes?cortarNo={법정동코드} (브라우저 세션 내 fetch — 쿠키 필요)
 *   응답의 complexNo→latitude/longitude를 DB에 매칭 업데이트. 좌표는 통근·상권 점수의 원천.
 * 실행: npx tsx scripts/backfill-coords.ts [--all]  (기본: lat IS NULL 단지가 속한 동만)
 * 주간 스윕 후에도 실행됨(naver-sweep.sh 마지막 단계) — 신규 단지 좌표 보충.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => base + Math.floor(Math.random() * 1500);

interface NewLandComplex { complexNo: string; latitude?: number; longitude?: number }

(async () => {
  const prisma = new PrismaClient();
  const all = process.argv.includes('--all');

  // 대상 동: 좌표 없는 단지가 속한 (gu, dong)
  const targets = await prisma.complexCandidate.groupBy({
    by: ['gu', 'dong'],
    where: all ? {} : { lat: null },
    _count: true,
  });
  if (!targets.length) { console.log('백필 대상 없음 — 전 단지 좌표 보유'); await prisma.$disconnect(); return; }

  // (gu,dong) → 법정동코드
  const { dongCodeOf } = await import('../src/lib/legal-dongs');
  const resolve = (gu: string, dong: string): string | null => dongCodeOf(gu, dong);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto('https://new.land.naver.com/complexes', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  let updated = 0, misses = 0;
  for (let i = 0; i < targets.length; i++) {
    const { gu, dong } = targets[i];
    const cortarNo = resolve(gu, dong);
    if (!cortarNo) { console.log(`  · ${gu} ${dong}: 동코드 미해석 — 건너뜀`); misses++; continue; }
    try {
      const res = await page.evaluate(async (code: string) => {
        const r = await fetch(`/api/regions/complexes?cortarNo=${code}&realEstateType=APT:ABYG:JGC&order=`, { headers: { Accept: 'application/json' } });
        if (!r.ok) return { ok: false as const, status: r.status };
        return { ok: true as const, list: ((await r.json())?.complexList ?? []) as NewLandComplex[] };
      }, cortarNo);
      if (!res.ok) {
        console.log(`  · ${gu} ${dong}: HTTP ${res.status} — 백오프 30s`);
        await sleep(30000);
        i--; // 재시도
        continue;
      }
      let n = 0;
      for (const c of res.list) {
        if (!c.latitude || !c.longitude) continue;
        const r = await prisma.complexCandidate.updateMany({ where: { complexNo: String(c.complexNo) }, data: { lat: c.latitude, lng: c.longitude } });
        n += r.count;
      }
      updated += n;
      console.log(`  [${i + 1}/${targets.length}] ${gu} ${dong}: 단지 ${res.list.length} → 갱신 ${n}`);
    } catch (e) {
      console.log(`  · ${gu} ${dong}: 실패(${e instanceof Error ? e.message.slice(0, 60) : e})`);
    }
    await sleep(jitter(3000));
  }
  await browser.close();

  const remain = await prisma.complexCandidate.count({ where: { lat: null } });
  console.log(`백필 완료 — 갱신 ${updated} · 동코드 미해석 ${misses} · 좌표 미보유 잔여 ${remain}`);
  await prisma.$disconnect();
})();
