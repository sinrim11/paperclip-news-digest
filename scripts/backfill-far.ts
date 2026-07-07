/**
 * backfill-far.ts — ComplexCandidate 용적률(far) 백필.
 *   new.land /api/complexes/single-markers/2.0 (브라우저 세션 내 fetch)가 floorAreaRatio 제공.
 *   동 단위로 단지 좌표 bbox를 만들어 조회 → markerId(=complexNo) 매칭 업데이트.
 *   용적률 = 재건축 사업성 핵심(낮을수록 유리) — 카드뉴스 레이더 지수·연식 축에 사용.
 * 실행: npx tsx scripts/backfill-far.ts [--all]  (기본: far IS NULL 단지가 있는 동만)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prisma = new PrismaClient();
  const all = process.argv.includes('--all');
  const cands = await prisma.complexCandidate.findMany({ where: { lat: { not: null } }, select: { complexNo: true, gu: true, dong: true, lat: true, lng: true, far: true } });
  const { loadDongCodeMap } = await import('../src/lib/legal-dongs');
  const seoul = loadDongCodeMap(); // 서울+경기 병합 맵(구/시 → 동 → 코드)

  // 동별 그룹(bbox 계산)
  const byDong = new Map<string, { gu: string; dong: string; items: typeof cands }>();
  for (const c of cands) {
    if (!all && c.far != null) continue;
    const k = `${c.gu}|${c.dong}`;
    if (!byDong.has(k)) byDong.set(k, { gu: c.gu, dong: c.dong, items: [] });
    byDong.get(k)!.items.push(c);
  }
  const targets = [...byDong.values()];
  if (!targets.length) { console.log('백필 대상 없음'); await prisma.$disconnect(); return; }
  console.log(`용적률 백필: ${targets.length}개 동`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto('https://new.land.naver.com/complexes', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  let updated = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const cortarNo = seoul[t.gu]?.[t.dong];
    if (!cortarNo) { console.log(`  · ${t.gu} ${t.dong}: 동코드 없음`); continue; }
    const lats = t.items.map((x) => x.lat!), lngs = t.items.map((x) => x.lng!);
    const pad = 0.012;
    // ⚠️ 네이버 API는 빈 파라미터(markerId·tag=:::::::: 등)까지 있어야 결과를 줌 — 실브라우저 쿼리 형태 그대로 유지
    const q = `cortarNo=${cortarNo}&zoom=16&priceType=RETAIL&markerId&markerType=COMPLEX&selectedComplexNo&selectedComplexBuildingNo&fakeComplexMarker&realEstateType=APT%3AABYG%3AJGC&tradeType=&tag=%3A%3A%3A%3A%3A%3A%3A%3A&rentPriceMin=0&rentPriceMax=900000000&priceMin=0&priceMax=900000000&areaMin=0&areaMax=900000000&oldBuildYears&recentlyBuildYears&minHouseHoldCount&maxHouseHoldCount&showArticle=false&sameAddressGroup=false&minMaintenanceCost&maxMaintenanceCost&directions=&leftLon=${Math.min(...lngs) - pad}&rightLon=${Math.max(...lngs) + pad}&topLat=${Math.max(...lats) + pad}&bottomLat=${Math.min(...lats) - pad}`;
    try {
      const res = await page.evaluate(async (query: string) => {
        const r = await fetch('/api/complexes/single-markers/2.0?' + query, { headers: { Accept: 'application/json' } });
        if (!r.ok) return { ok: false as const, status: r.status };
        return { ok: true as const, list: await r.json() };
      }, q);
      if (!res.ok) { console.log(`  · ${t.gu} ${t.dong}: HTTP ${res.status} — 20s 백오프`); await sleep(20000); i--; continue; }
      const markers = (Array.isArray(res.list) ? res.list : []) as Array<{ markerId?: string | number; complexNo?: string | number; floorAreaRatio?: number }>;
      let n = 0;
      for (const m of markers) {
        const no = String(m.markerId ?? m.complexNo ?? '');
        if (!no || m.floorAreaRatio == null || m.floorAreaRatio <= 0) continue;
        const r2 = await prisma.complexCandidate.updateMany({ where: { complexNo: no }, data: { far: m.floorAreaRatio } });
        n += r2.count;
      }
      updated += n;
      console.log(`  [${i + 1}/${targets.length}] ${t.gu} ${t.dong}: 마커 ${markers.length} → 갱신 ${n}`);
    } catch (e) {
      console.log(`  · ${t.gu} ${t.dong} 실패: ${e instanceof Error ? e.message.slice(0, 50) : e}`);
    }
    await sleep(2500 + Math.random() * 1500);
  }
  await browser.close();
  const remain = await prisma.complexCandidate.count({ where: { far: null, lat: { not: null } } });
  console.log(`완료 — 갱신 ${updated} · 용적률 미보유 잔여 ${remain}`);
  await prisma.$disconnect();
})();
