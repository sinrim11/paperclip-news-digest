/**
 * collect-kapt.ts — K-apt(공동주택관리정보시스템) 관리비·주차·교통 수집.
 *
 * 왜: 초보 매수자가 가장 크게 오판하는 것이 '월 부담'이다. 우리는 대출 원리금만 보여줘서
 * 오히려 과소 표시를 조장하고 있었다. 관리비와 재산세를 더해야 실제 월 부담이 나온다.
 *
 * 매핑: kaptCode는 시군구 단위 목록(getSigunguAptList4)에서 얻는다. 법정동 단위로 부르면
 * 읍·면 지역이 0건으로 나온다(리 단위 코드를 쓰기 때문) — 실측에서 남양주 3개 읍이 전부
 * 빈손이었다. 시군구로 바꾸면 매핑률이 53%→72%로 오른다.
 * 못 맞춘 나머지에는 K-apt에 아예 없는 단지가 섞여 있다(300세대 미만은 의무관리 대상이 아니다).
 *
 * 실행: npx tsx scripts/collect-kapt.ts [--limit=N] [--gu=남양주시]
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { LAWD_GU } from '../src/lib/tiers';
import { normName, normDong } from '../src/lib/trade-key';

const KEY = process.env.DATA_GO_KR_API_KEY;
const BASE = 'https://apis.data.go.kr/1613000';
const OUT = join(process.cwd(), 'config', 'kapt-cache.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * K-apt 매칭 전용 정규화 — 실거래 조인용 normName보다 공격적이다.
 * 네이버는 '중흥S-클래스'·'e-편한세상', K-apt는 '중흥S클래스'·'e편한세상'처럼 쓴다.
 * 실거래 조인에 같은 규칙을 쓰면 기존 매칭이 흔들리므로 여기서만 쓴다.
 */
const kaptName = (s: string) => normName(s).replace(/[-–—·.,()[\]/]/g, '').toLowerCase();

interface KaptItem { kaptCode: string; kaptName: string; as3?: string; as4?: string }
interface Fee { month: string; commonTotal: number | null; individualTotal: number | null; ltrmMonthly: number | null; ltrmBalance: number | null }
export interface KaptRecord {
  kaptCode: string;
  kaptName: string;
  /** 법정동 주소 — "서울특별시 관악구 신림동 1693 국제산장아파트" 형태로 지번이 들어 있다.
   *  공시가격 PNU를 만들 때 실거래 이름 매칭보다 이쪽이 정확하다(2026-09-12). */
  kaptAddr: string | null;
  household: number | null;
  parkingTotal: number | null;   // 지상+지하
  parkingPerHousehold: number | null;
  subwayLine: string | null;
  subwayStation: string | null;
  subwayWalkMin: string | null;
  fee: Fee | null;
  fetchedAt: string;
}

async function api<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const q = new URLSearchParams({ serviceKey: KEY!, _type: 'json', ...params });
  try {
    const r = await fetch(`${BASE}/${path}?${q}`, { signal: AbortSignal.timeout(15_000) });
    const j = (await r.json()) as Record<string, unknown>;
    if ('OpenAPI_ServiceResponse' in j) return null; // 미신청·경로오류
    const body = (j as { response?: { body?: { item?: T } } }).response?.body;
    return (body?.item as T) ?? null;
  } catch {
    return null;
  }
}

async function listSigungu(code: string): Promise<KaptItem[]> {
  const out: KaptItem[] = [];
  for (let page = 1; page <= 8; page++) {
    const q = new URLSearchParams({ serviceKey: KEY!, _type: 'json', sigunguCode: code, numOfRows: '500', pageNo: String(page) });
    try {
      const r = await fetch(`${BASE}/AptListService4/getSigunguAptList4?${q}`, { signal: AbortSignal.timeout(20_000) });
      const j = (await r.json()) as any;
      let items = j?.response?.body?.items ?? [];
      if (items && !Array.isArray(items)) items = items.item ?? [];
      if (items && !Array.isArray(items)) items = [items];
      out.push(...(items ?? []));
      if (out.length >= Number(j?.response?.body?.totalCount ?? 0)) break;
    } catch {
      break;
    }
    await sleep(150);
  }
  return out;
}

/** 직전 달 — K-apt 공개는 한두 달 지연되므로 최근 3개월을 거슬러 시도한다. */
function recentMonths(n = 3): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 1; i <= n; i++) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function fetchFee(kaptCode: string): Promise<Fee | null> {
  for (const month of recentMonths()) {
    const [elec, heat, water, gas, ltrmM, ltrmB] = await Promise.all([
      api<{ electC?: number; electP?: number }>('AptIndvdlzManageCostServiceV3/getHsmpElectricityCostInfoV3', { kaptCode, searchDate: month }),
      api<{ heatC?: number; heatP?: number }>('AptIndvdlzManageCostServiceV3/getHsmpHeatCostInfoV3', { kaptCode, searchDate: month }),
      api<{ waterCoolC?: number; waterCoolP?: number }>('AptIndvdlzManageCostServiceV3/getHsmpWaterCostInfoV3', { kaptCode, searchDate: month }),
      api<{ gasC?: number; gasP?: number }>('AptIndvdlzManageCostServiceV3/getHsmpGasRentalFeeInfoV3', { kaptCode, searchDate: month }),
      api<{ sLevy?: number }>('AptRepairsCostServiceV3/getHsmpMonthFeeInfoV3', { kaptCode, searchDate: month }),
      api<{ sTot?: number }>('AptRepairsCostServiceV3/getHsmpReserveBalanceInfoV3', { kaptCode, searchDate: month }),
    ]);
    // 이 API는 금액을 문자열로 준다("electC":"6356129"). 숫자 타입만 받으면 전부 0이 된다.
    const num = (x: unknown) => {
      const v = typeof x === 'string' ? Number(x) : x;
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    };
    // C=공용, P=개별(세대 부과분). 세대가 실제 내는 건 개별분이 중심이다.
    const common = num(elec?.electC) + num(heat?.heatC) + num(water?.waterCoolC) + num(gas?.gasC);
    const individual = num(elec?.electP) + num(heat?.heatP) + num(water?.waterCoolP) + num(gas?.gasP);
    if (common + individual > 0 || ltrmM?.sLevy) {
      return {
        month,
        commonTotal: common || null,
        individualTotal: individual || null,
        ltrmMonthly: num(ltrmM?.sLevy) || null,
        ltrmBalance: num(ltrmB?.sTot) || null,
      };
    }
    await sleep(100);
  }
  return null;
}

(async () => {
  if (!KEY) { console.error('DATA_GO_KR_API_KEY 없음'); process.exit(1); }
  const prisma = new PrismaClient();
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0);
  const guArg = process.argv.find((a) => a.startsWith('--gu='))?.slice(5);

  let cache: Record<string, KaptRecord> = {};
  try { cache = JSON.parse(readFileSync(OUT, 'utf-8')); } catch { /* 첫 실행 */ }

  // 예산 내 매물이 있는 단지 우선 — 화면에 실제로 보이는 것부터 채운다
  const cands = await prisma.complexCandidate.findMany({
    where: { inBudgetCount: { gt: 0 }, ...(guArg ? { gu: guArg } : {}) },
    select: { complexNo: true, gu: true, dong: true, name: true, household: true },
    orderBy: { inBudgetCount: 'desc' },
    ...(limit ? { take: limit } : {}),
  });
  const guToCode = new Map(Object.entries(LAWD_GU as Record<string, string>).map(([c, g]) => [g, c]));
  const byGu = new Map<string, typeof cands>();
  for (const c of cands) (byGu.get(c.gu) ?? byGu.set(c.gu, []).get(c.gu)!).push(c);

  let mapped = 0, fetched = 0, skipped = 0;
  const rejected: string[] = []; // 세대수 불일치로 버린 매칭 — 조용히 버리면 왜 비었는지 알 수 없다
  for (const [gu, list] of byGu) {
    const code = guToCode.get(gu);
    if (!code) { console.log(`  ${gu}: 시군구 코드 미해석 — 건너뜀`); continue; }
    const kapt = await listSigungu(code);
    const idx = new Map<string, KaptItem>();
    for (const x of kapt) idx.set(`${normDong(x.as3 ?? '')}|${kaptName(x.kaptName)}`, x);

    for (const c of list) {
      if (cache[c.complexNo]) { skipped++; continue; } // 이미 수집됨 — 관리비는 월 단위라 자주 바뀌지 않는다
      const d = normDong(c.dong), n = kaptName(c.name);
      let hit = idx.get(`${d}|${n}`);
      if (!hit) {
        const k = [...idx.keys()].find((key) => {
          const i = key.indexOf('|');
          return key.slice(0, i) === d && (key.slice(i + 1).includes(n) || n.includes(key.slice(i + 1)));
        });
        if (k) hit = idx.get(k);
      }
      if (!hit) continue;
      mapped++;

      // 세대수 대조 — 이름만으로 매칭하면 같은 동의 비슷한 이름에 붙을 수 있다.
      // 틀린 관리비를 보여주는 건 안 보여주는 것보다 나쁘므로, 세대수가 15% 넘게 어긋나면 버린다.
      const bass = await api<{ kaptdaCnt?: number | string; kaptAddr?: string }>('AptBasisInfoServiceV5/getAphusBassInfoV5', { kaptCode: hit.kaptCode });
      const kHh = Number(bass?.kaptdaCnt ?? 0);
      if (kHh > 0 && c.household > 0 && Math.abs(kHh - c.household) / c.household > 0.15) {
        rejected.push(`${c.gu} ${c.dong} ${c.name}(${c.household}) ↔ ${hit.kaptName}(${kHh})`);
        continue;
      }

      const [dtl, fee] = await Promise.all([
        api<Record<string, string>>('AptBasisInfoServiceV5/getAphusDtlInfoV5', { kaptCode: hit.kaptCode }),
        fetchFee(hit.kaptCode),
      ]);
      const pg = Number(dtl?.kaptdPcnt ?? 0), pu = Number(dtl?.kaptdPcntu ?? 0);
      const total = pg + pu;
      cache[c.complexNo] = {
        kaptCode: hit.kaptCode,
        kaptName: hit.kaptName,
        kaptAddr: bass?.kaptAddr ?? null,
        household: c.household,
        parkingTotal: total || null,
        parkingPerHousehold: total && c.household ? Math.round((total / c.household) * 100) / 100 : null,
        subwayLine: dtl?.subwayLine ?? null,
        subwayStation: dtl?.subwayStation ?? null,
        subwayWalkMin: dtl?.kaptdWtimesub ?? null,
        fee,
        fetchedAt: new Date().toISOString().slice(0, 10),
      };
      fetched++;
      if (fetched % 20 === 0) {
        writeFileSync(OUT, JSON.stringify(cache, null, 2));
        console.log(`  … ${fetched}건 수집 (누적 ${Object.keys(cache).length})`);
      }
      await sleep(120);
    }
    console.log(`  ${gu}: 대상 ${list.length} · 매핑 ${mapped} · 신규수집 ${fetched}`);
  }

  mkdirSync(join(process.cwd(), 'config'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(cache, null, 2));
  const withFee = Object.values(cache).filter((x) => x.fee).length;
  console.log(`\n완료 — 캐시 ${Object.keys(cache).length}단지(관리비 보유 ${withFee}) · 신규 ${fetched} · 기존 ${skipped}`);
  if (rejected.length) {
    console.log(`세대수 불일치로 거부 ${rejected.length}건:`);
    for (const r of rejected.slice(0, 10)) console.log(`  ✗ ${r}`);
  }
  await prisma.$disconnect();
})();
