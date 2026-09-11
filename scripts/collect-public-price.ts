/**
 * collect-public-price.ts — 공동주택 공시가격 수집 (vworld).
 *
 * 재산세의 기준값이다. 총 월 실부담에서 원리금·관리비 다음 세 번째 축.
 *
 * 두 가지 함정을 미리 적어둔다(둘 다 실제로 겪었다):
 *  ① vworld 키는 **Referer 헤더가 없으면** 키가 유효해도 INCORRECT_KEY를 준다.
 *  ② 조회 단위가 PNU(19자리)다. 단지명으로는 못 찾는다.
 *     PNU = 법정동코드10 + 1(토지) + 본번4 + 부번4.
 *     법정동코드는 legal-dongs, 본번·부번은 실거래(AptTrade.jibun)에서 얻는다.
 *
 * 한 PNU에 여러 면적의 공시가격이 딸려 오므로, 단지 대표값은 면적대별로 보관한다.
 *
 * 실행: npx tsx scripts/collect-public-price.ts [--limit=N]
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { dongCodeOf } from '../src/lib/legal-dongs';
import { normName, normDong, loosName } from '../src/lib/trade-key';

const KEY = process.env.VWORLD_API_KEY;
const OUT = join(process.cwd(), 'config', 'public-price-cache.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PriceRow { prvuseAr: string; pblntfPc: string; stdrYear: string }
export interface PriceRecord {
  pnu: string;
  year: string;
  /** 전용면적(㎡) → 공시가격(원). 같은 단지라도 평형마다 다르다. */
  byArea: Array<{ area: number; won: number }>;
  fetchedAt: string;
}

async function fetchPrice(pnu: string, year: string): Promise<PriceRow[]> {
  const url = `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?key=${KEY}&pnu=${pnu}&stdrYear=${year}&format=json&numOfRows=100&pageNo=1`;
  try {
    const r = await fetch(url, { headers: { Referer: 'http://localhost' }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as any;
    const f = j?.apartHousingPrices?.field;
    if (!f) return [];
    return Array.isArray(f) ? f : [f];
  } catch {
    return [];
  }
}

(async () => {
  if (!KEY) { console.error('VWORLD_API_KEY 없음'); process.exit(1); }
  const prisma = new PrismaClient();
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0);

  let cache: Record<string, PriceRecord> = {};
  try { cache = JSON.parse(readFileSync(OUT, 'utf-8')); } catch { /* 첫 실행 */ }

  const cands = await prisma.complexCandidate.findMany({
    where: { inBudgetCount: { gt: 0 } },
    select: { complexNo: true, gu: true, dong: true, name: true },
    orderBy: { inBudgetCount: 'desc' },
    ...(limit ? { take: limit } : {}),
  });

  // 지번은 실거래에서 — 같은 단지의 최빈 지번을 쓴다(동별로 여러 필지인 경우 대표 1개)
  const since = new Date(Date.now() - 365 * 86_400_000);
  const trades = await prisma.aptTrade.findMany({
    where: { dealDate: { gte: since }, jibun: { not: null } },
    select: { dong: true, aptName: true, jibun: true },
  });
  const jibunOf = new Map<string, Map<string, number>>();
  const addJibun = (k: string, j: string) => {
    const m = jibunOf.get(k) ?? new Map<string, number>();
    m.set(j, (m.get(j) ?? 0) + 1);
    jibunOf.set(k, m);
  };
  for (const t of trades) {
    addJibun(`${normDong(t.dong)}|${normName(t.aptName)}`, t.jibun!);
    addJibun(`~${normDong(t.dong)}|${loosName(t.aptName)}`, t.jibun!); // 느슨 키(하이픈·점 제거)
  }
  const year = String(new Date().getFullYear());

  let hit = 0, miss = 0, skipped = 0;
  for (const c of cands) {
    if (cache[c.complexNo]) { skipped++; continue; }
    const bjd = dongCodeOf(c.gu, c.dong);
    // 정확 → 느슨 → 부분포함 순으로 내려간다. 지번을 못 찾으면 공시가격 조회 자체가 불가능하다.
    const dk = normDong(c.dong);
    let jm = jibunOf.get(`${dk}|${normName(c.name)}`) ?? jibunOf.get(`~${dk}|${loosName(c.name)}`);
    if (!jm) {
      const ln = loosName(c.name);
      const key = [...jibunOf.keys()].find((k) => {
        if (!k.startsWith(`~${dk}|`)) return false;
        const n = k.slice(dk.length + 2);
        return n.includes(ln) || ln.includes(n);
      });
      if (key) jm = jibunOf.get(key);
    }
    if (!bjd || !jm?.size) { miss++; continue; }
    // 최빈 지번
    const jibun = [...jm.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const [bon, bu] = jibun.split('-');
    const pnu = `${bjd}1${String(bon).padStart(4, '0')}${String(bu ?? '0').padStart(4, '0')}`;

    let rows = await fetchPrice(pnu, year);
    if (!rows.length) rows = await fetchPrice(pnu, String(Number(year) - 1)); // 올해 미공시면 작년
    if (!rows.length) { miss++; await sleep(120); continue; }

    // 같은 면적이 여러 층으로 중복되므로 면적별 중앙값을 쓴다
    const byArea = new Map<number, number[]>();
    for (const r of rows) {
      const a = Math.round(Number(r.prvuseAr) * 10) / 10;
      const w = Number(r.pblntfPc);
      if (!Number.isFinite(a) || !Number.isFinite(w) || w <= 0) continue;
      (byArea.get(a) ?? byArea.set(a, []).get(a)!).push(w);
    }
    const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    cache[c.complexNo] = {
      pnu,
      year: rows[0].stdrYear,
      byArea: [...byArea.entries()].map(([area, ws]) => ({ area, won: med(ws) })).sort((a, b) => a.area - b.area),
      fetchedAt: new Date().toISOString().slice(0, 10),
    };
    hit++;
    if (hit % 25 === 0) { writeFileSync(OUT, JSON.stringify(cache, null, 2)); console.log(`  … ${hit}건`); }
    await sleep(120);
  }
  writeFileSync(OUT, JSON.stringify(cache, null, 2));
  console.log(`완료 — 캐시 ${Object.keys(cache).length}단지 · 신규 ${hit} · 실패 ${miss} · 기존 ${skipped}`);
  await prisma.$disconnect();
})();
