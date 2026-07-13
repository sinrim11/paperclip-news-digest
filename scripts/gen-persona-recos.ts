/**
 * scripts/gen-persona-recos.ts — 페르소나별 추천 사전 생성(G3).
 *   listings-analysis.json(전 매물 투자분석)을 입력으로 5개 페르소나(출퇴근/투자/신축/주거환경/가성비)
 *   각각의 TOP N 단지를 결정적 규칙(src/lib/listing-personas.ts)으로 산출 → config/persona-recos.json.
 *   /recommend 페르소나 섹션이 소비. LLM·신규 수집 없음 — 각 항목에 핵심 원천 수치(metric) 동반.
 * 실행: npx tsx scripts/gen-persona-recos.ts  (gen-listings 직후 — daily-matching.sh·naver-sweep.sh가 호출)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { LISTING_PERSONAS, type PersonaRow } from '../src/lib/listing-personas';

const TOP_N = 5;
const MAX_PER_GU = 2; // 지역 편중 방지 — 추천 다양성

interface Row extends PersonaRow {
  complexNo: string;
  complexName: string;
  gu: string;
  dong: string;
  floor: string | null;
}

interface RecoItem {
  complexNo: string;
  name: string;
  gu: string;
  dong: string;
  price: number; // 만원(페르소나 정렬 기준 매물)
  area: number | null;
  elapsedYear: number | null;
  household: number;
  totalScore: number;
  metric: string; // 페르소나별 핵심 원천 수치(검증용)
  tradeCount: number;
  jeonseRatioPct: number;
}

function main() {
  const data = JSON.parse(readFileSync(join(process.cwd(), 'config', 'listings-analysis.json'), 'utf-8')) as {
    asOf: string;
    listings: Row[];
  };

  const personas = Object.entries(LISTING_PERSONAS).map(([key, p]) => {
    let rows = data.listings;
    if (p.filter) rows = rows.filter(p.filter);
    rows = [...rows].sort(p.sort);
    // 단지 dedupe(정렬 1위 매물이 대표) + 구·시별 캡
    const seen = new Set<string>();
    const perGu: Record<string, number> = {};
    const items: RecoItem[] = [];
    for (const r of rows) {
      if (seen.has(r.complexNo)) continue;
      if ((perGu[r.gu] ?? 0) >= MAX_PER_GU) continue;
      seen.add(r.complexNo);
      perGu[r.gu] = (perGu[r.gu] ?? 0) + 1;
      items.push({
        complexNo: r.complexNo,
        name: r.complexName,
        gu: r.gu,
        dong: r.dong,
        price: r.price,
        area: r.area,
        elapsedYear: r.elapsedYear,
        household: r.household,
        totalScore: r.a.totalScore,
        metric: p.metric(r),
        tradeCount: r.tradeCount,
        jeonseRatioPct: r.jeonseRatioPct,
      });
      if (items.length >= TOP_N) break;
    }
    return { key, label: p.label, desc: p.desc, items };
  });

  const out = {
    _comment: 'gen-persona-recos 자동 생성(gen-listings 직후) — /recommend 페르소나 섹션 소비. 규칙: src/lib/listing-personas.ts',
    asOf: data.asOf,
    generatedAt: new Date().toISOString(),
    personas,
  };
  writeFileSync(join(process.cwd(), 'config', 'persona-recos.json'), JSON.stringify(out, null, 2));
  console.log(`[persona-recos] ${data.asOf} — ${personas.map((p) => `${p.key} ${p.items.length}건`).join(' · ')}`);
}

main();
