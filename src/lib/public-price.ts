/**
 * public-price.ts — 공시가격 조회 (2026-09-12).
 *
 * 재산세 계산용. 같은 단지라도 평형마다 공시가격이 달라서, 매물 전용면적에 가장 가까운
 * 면적대를 고른다. 면적을 모르면 중앙값을 쓴다 — 없는 것보다 근사치가 낫지만, 근사라는
 * 사실이 화면에 드러나야 하므로 호출부에서 '재산세' 문구에 단서를 단다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

interface PriceRecord { pnu: string; year: string; byArea: Array<{ area: number; won: number }> }

let cache: Record<string, PriceRecord> | null | undefined;
function load(): Record<string, PriceRecord> | null {
  if (cache !== undefined) return cache ?? null;
  try { cache = JSON.parse(readFileSync(join(process.cwd(), 'config', 'public-price-cache.json'), 'utf-8')); }
  catch { cache = null; }
  return cache ?? null;
}

export function publicPriceOf(complexNo: string | undefined, areaM2: number | null): number | null {
  if (!complexNo) return null;
  const rec = load()?.[complexNo];
  if (!rec?.byArea.length) return null;
  if (areaM2 == null) {
    const mid = rec.byArea[Math.floor(rec.byArea.length / 2)];
    return mid?.won ?? null;
  }
  // 전용면적이 가장 가까운 구간
  let best = rec.byArea[0];
  for (const x of rec.byArea) if (Math.abs(x.area - areaM2) < Math.abs(best.area - areaM2)) best = x;
  return best.won;
}

export function publicPriceYear(complexNo: string | undefined): string | null {
  if (!complexNo) return null;
  return load()?.[complexNo]?.year ?? null;
}
