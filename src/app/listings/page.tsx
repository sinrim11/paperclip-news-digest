import Link from 'next/link';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { cookies } from 'next/headers';
import InvestBreakdown, { type InvestBreakdownData } from '@/components/InvestBreakdown';
import MethodologyNote from '@/components/MethodologyNote';
import ProfileBadge from '@/components/ProfileBadge';
import DecisionFlow from '@/components/DecisionFlow';
import { CompareToggle, CompareBar } from '@/components/CompareControls';
import { resolveContext, PROFILE_COOKIE } from '@/lib/profiles';
import { analyzeWithVersus, listingsCompact } from '@/lib/invest-compact';
import { computeCommute, computeAmenity, computeAmenityKakao, lineLabel, type KakaoCtx } from '@/lib/commute';

/** 카카오 실데이터 캐시 로더 — 커스텀 프로필 재계산용. 출근지가 캐시와 다르면 자차 실경로 무효화 */
function loadKakaoCtx(workLat: number, workLng: number): Record<string, KakaoCtx> {
  try {
    const kc = JSON.parse(readFileSync(join(process.cwd(), 'config', 'kakao-context.json'), 'utf-8'));
    const same = kc.workKey === `${workLat.toFixed(5)},${workLng.toFixed(5)}`;
    const out: Record<string, KakaoCtx> = {};
    for (const [no, e] of Object.entries(kc.complexes as Record<string, KakaoCtx>)) {
      out[no] = same ? e : { ...e, driveMin: null, driveKm: null };
    }
    return out;
  } catch {
    return {};
  }
}

export const dynamic = 'force-dynamic';
export const metadata = { title: '전체 매물 · 투자분석 | 뉴스 다이제스트' };

interface Score { label: string; score: number; weight: number; formula: string; basis: string }
interface Analysis {
  totalScore: number; equityIn: number; loan: number; bindingCap: string; feasibleToday: boolean; feasible2yr: boolean;
  ltvLoan: number; dsrLoanCap: number; remainingLoan: number; projected2yr: number; usableToday: number;
  monthlyPayment: number; holdingCost: number; interest2yr: number; acqTaxNet: number; propertyTax2yr: number;
  base: { apprPct: number; futureValue: number; gain: number; netProfit: number; roeAnnualPct: number };
  conservative: { roeAnnualPct: number }; optimistic: { roeAnnualPct: number };
  jeonseDeposit: number; loanCleared: boolean; cashReleased: number; interestReductionPct: number; wolseNetMonthly: number;
  breakevenApprPct: number; altVerdict: string; scores: Score[];
}
interface Versus { gStar: number; winner: string; a10: number; b10: number; rPct: number }
interface Cm { station: string; lines: string; walkMin: number; transfers: number; totalMin: number; driveMin: number; driveReal?: boolean; straightKm: number; busDependent: boolean; score: number; workLabel: string }
interface Am { score: number; stationsIn1km: number; nearestWalkMin: number }
interface Row {
  complexNo: string; complexName: string; gu: string; dong: string; household: number; elapsedYear: number | null;
  lat?: number | null; lng?: number | null; dongHH?: number;
  price: number; area: number | null; floor: string | null; unitDong: string | null;
  articleNo?: number | null;
  listedDate?: string | null; dir?: string | null;
  jeonseRatioPct: number; jeonseEstimated: boolean; tradeMedian: number | null; tradeCount: number; latestTradeDate: string | null; sweptAt: string;
  cm?: Cm | null; am?: Am | null;
  a: Analysis;
  vs?: Versus;
}
/** 단지 그룹(네이버식 대표매물 — 단지당 카드 1장) — rep = 정렬 기준 최상위 매물 */
interface Group { key: string; rep: Row; items: Row[]; minPrice: number; maxPrice: number; minArea: number | null; maxArea: number | null }

const naverArticleUrl = (r: Row) => (r.articleNo ? `https://fin.land.naver.com/articles/${r.articleNo}` : `https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`);
interface Data { asOf: string; generatedAt: string; budget: { comfortable: number; stretch: number }; model: { loanRatePct: number; baseApprPct: number; holdYears: number; altReturnsPct: Record<string, number> }; work?: { label: string; purposeLive: boolean }; count: number; listings: Row[] }

// ── mtime 캐시 로더(7MB JSON 매요청 재파싱 방지) ──
let CACHE: { mtime: number; data: Data } | null = null;
function loadData(): Data | null {
  try {
    const p = join(process.cwd(), 'config', 'listings-analysis.json');
    const mtime = statSync(p).mtimeMs;
    if (!CACHE || CACHE.mtime !== mtime) CACHE = { mtime, data: JSON.parse(readFileSync(p, 'utf-8')) as Data };
    return CACHE.data;
  } catch {
    return null;
  }
}

const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const LIMIT = 80;
const areaBand = (a: number | null) => (a == null ? '?' : a < 40 ? '~40㎡' : a < 60 ? '50㎡대' : a < 75 ? '60~74㎡' : a < 90 ? '84㎡급' : '90㎡+');

/** 경기 지역 판별 — 필터 UI 서울/경기 그룹화(G2-1) */
const isGyeonggi = (gu: string) => gu.endsWith('시') || gu.includes(' ');

/** 금액대 밴드(G2-2) — price 만원 기준 [min, max) */
const PRICE_BANDS: Array<{ key: string; label: string; min: number; max: number | null }> = [
  { key: 'b5', label: '~5억', min: 0, max: 50000 },
  { key: 'b56', label: '5~6억', min: 50000, max: 60000 },
  { key: 'b67', label: '6~7억', min: 60000, max: 70000 },
  { key: 'b78', label: '7~8억', min: 70000, max: 80000 },
  { key: 'b8p', label: '8억+', min: 80000, max: null },
];

/** 페르소나 프리셋(G2-5) — 기존 계산 필드의 결정적 필터+정렬 재조합(신규 수집 0, 판단은 사람) */
const LISTING_PERSONAS: Record<string, { label: string; desc: string; filter?: (r: Row) => boolean; sort: (a: Row, b: Row) => number }> = {
  commute: {
    label: '🚇 출퇴근 우선',
    desc: '통근 총 소요시간 오름차순(카카오 실경로/근사) — 통근 계산 불가 매물 제외',
    filter: (r) => r.cm != null,
    sort: (a, b) => (a.cm!.totalMin - b.cm!.totalMin) || b.a.totalScore - a.a.totalScore,
  },
  invest: {
    label: '📈 투자수익 우선',
    desc: '기본 시나리오 연 ROE 내림차순 · 동률 시 전세가율(임대전환 용이) 순',
    sort: (a, b) => (b.a.base.roeAnnualPct - a.a.base.roeAnnualPct) || b.jeonseRatioPct - a.jeonseRatioPct,
  },
  newbuild: {
    label: '🏗️ 신축 우선',
    desc: '10년 이내 준신축만 · 연식 오름차순 — 감가방어·임대선호',
    filter: (r) => r.elapsedYear != null && r.elapsedYear <= 10,
    sort: (a, b) => ((a.elapsedYear ?? 99) - (b.elapsedYear ?? 99)) || b.a.totalScore - a.a.totalScore,
  },
  environ: {
    label: '🌳 주거환경 우선',
    desc: '상권·역세권 실측 점수 내림차순 · 동률 시 대단지 순 — 실측 없는 매물 제외',
    filter: (r) => r.am != null,
    sort: (a, b) => (b.am!.score - a.am!.score) || b.household - a.household,
  },
  value: {
    label: '💎 가성비',
    desc: '전용 ㎡당 가격 오름차순 — 종합점수 45+ · 실거래 3건+ 검증분만(싼 이유가 있는 매물 배제 아님, 리스크는 카드에서 확인)',
    filter: (r) => r.area != null && r.a.totalScore >= 45 && r.tradeCount >= 3,
    sort: (a, b) => a.price / (a.area ?? 1) - b.price / (b.area ?? 1),
  },
};

function scoreColor(s: number) {
  return s >= 70 ? 'text-emerald-600' : s >= 50 ? 'text-blue-600' : s >= 35 ? 'text-amber-600' : 'text-red-500';
}
function ScoreBar({ score }: { score: number }) {
  const c = score >= 70 ? 'bg-emerald-500' : score >= 50 ? 'bg-blue-500' : score >= 35 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
      <div className={`h-full ${c}`} style={{ width: `${Math.max(3, score)}%` }} />
    </div>
  );
}

export default async function ListingsPage({ searchParams }: { searchParams?: Promise<{ gu?: string; sort?: string; area?: string; max?: string; feasible?: string; band?: string; persona?: string }> }) {
  const sp = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const ctx = resolveContext(cookieStore.get(PROFILE_COOKIE)?.value);
  const data = loadData();
  if (!data) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-bold">전체 매물 · 투자분석</h1>
        <p className="mt-4 text-gray-500">분석 데이터가 없습니다. <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">npx tsx scripts/gen-listings.ts</code> 실행 후 표시됩니다.</p>
      </main>
    );
  }

  const gus = Array.from(new Set(data.listings.map((r) => r.gu))).sort();
  let rows = data.listings;
  // 커스텀 프로필: 저장된 프로필-독립 데이터(가격·전세가율·실거래·연식·지역상승률·좌표)로 전건 재계산(실측 ~수백 ms)
  if (ctx && !ctx.isDefault) {
    const kakaoByNo = loadKakaoCtx(ctx.work.lat, ctx.work.lng);
    const cmCache = new Map<string, { cm: Cm | null; commute: { score: number; formula: string; basis: string } | null; amenity: { score: number; formula: string; basis: string } | null; am: Am | null }>();
    rows = rows.map((r) => {
      let cc = cmCache.get(r.complexNo);
      if (!cc) {
        if (r.lat != null && r.lng != null) {
          const kc = kakaoByNo[r.complexNo] ?? null;
          const c2 = computeCommute(r.lat, r.lng, ctx.work, kc);
          const a2 = kc?.counts ? computeAmenityKakao(kc.counts, kc.subway?.distanceM ?? null, r.lat, r.lng, ctx.lifestyle) : computeAmenity(r.lat, r.lng, r.dongHH ?? r.household);
          cc = {
            cm: { station: c2.origin.name, lines: c2.origin.lines.map(lineLabel).join('·'), walkMin: c2.origin.walkMin, transfers: c2.transfers, totalMin: c2.totalMin, driveMin: c2.driveMin, driveReal: c2.driveReal, straightKm: c2.straightKm, busDependent: c2.busDependent, score: c2.score, workLabel: c2.workLabel },
            commute: { score: c2.score, formula: c2.formula, basis: c2.basis },
            amenity: { score: a2.score, formula: a2.formula, basis: a2.basis },
            am: { score: a2.score, stationsIn1km: a2.stationsIn1km, nearestWalkMin: a2.nearestWalkMin },
          };
        } else cc = { cm: null, commute: null, amenity: null, am: null };
        cmCache.set(r.complexNo, cc);
      }
      const { a, vs } = analyzeWithVersus(
        { priceManwon: r.price, jeonseRatioPct: r.jeonseRatioPct, tradeCount: r.tradeCount, elapsedYear: r.elapsedYear, household: r.household, apprBasePct: r.a.base.apprPct, purposeLive: ctx.purposeLive, commute: cc.commute, amenity: cc.amenity },
        ctx.fin, ctx.params, ctx.model,
      );
      return { ...r, a: listingsCompact(a) as unknown as Analysis, vs, cm: cc.cm, am: cc.am };
    });
  }
  if (sp.gu) rows = rows.filter((r) => r.gu === sp.gu);
  if (sp.area) rows = rows.filter((r) => areaBand(r.area) === sp.area);
  if (sp.max) { const m = Number(sp.max) * 10000; rows = rows.filter((r) => r.price <= m); }
  if (sp.feasible === 'today') rows = rows.filter((r) => r.a.feasibleToday);
  else if (sp.feasible === '2yr') rows = rows.filter((r) => r.a.feasible2yr);
  // 금액대 밴드(G2-2)
  const band = PRICE_BANDS.find((b) => b.key === sp.band);
  if (band) rows = rows.filter((r) => r.price >= band.min && (band.max == null || r.price < band.max));
  // 페르소나 프리셋(G2-5) — 활성 시 전용 필터+정렬이 sort 파라미터를 대체
  const persona = sp.persona && LISTING_PERSONAS[sp.persona] ? LISTING_PERSONAS[sp.persona] : null;
  if (persona?.filter) rows = rows.filter(persona.filter);
  const sort = sp.sort ?? 'score';
  rows = [...rows].sort(
    persona
      ? persona.sort
      : (a, b) =>
        sort === 'price' ? a.price - b.price
          : sort === 'roe' ? b.a.base.roeAnnualPct - a.a.base.roeAnnualPct
            : sort === 'jeonse' ? b.jeonseRatioPct - a.jeonseRatioPct
              : sort === 'commute' ? (a.cm?.totalMin ?? 999) - (b.cm?.totalMin ?? 999)
                : b.a.totalScore - a.a.totalScore,
  );

  // ── 단지 그룹핑(네이버식 대표매물 — 단지당 카드 1장): 정렬 1위가 대표, 나머지는 펼침에서 ──
  const groupMap = new Map<string, Group>();
  for (const r of rows) {
    const key = r.complexNo;
    const g = groupMap.get(key);
    if (!g) groupMap.set(key, { key, rep: r, items: [r], minPrice: r.price, maxPrice: r.price, minArea: r.area, maxArea: r.area });
    else {
      g.items.push(r);
      g.minPrice = Math.min(g.minPrice, r.price); g.maxPrice = Math.max(g.maxPrice, r.price);
      if (r.area != null) { g.minArea = g.minArea == null ? r.area : Math.min(g.minArea, r.area); g.maxArea = g.maxArea == null ? r.area : Math.max(g.maxArea, r.area); }
    }
  }
  const groups = [...groupMap.values()]; // Map 삽입순 = rows 정렬순 → rep 기준 정렬 유지
  const shown = groups.slice(0, LIMIT);
  const totalListings = rows.length;

  const chip = (label: string, params: Record<string, string>, active: boolean) => {
    const q = new URLSearchParams({ ...(sp as Record<string, string>), ...params });
    Object.entries(params).forEach(([k, v]) => { if (v === '') q.delete(k); });
    return (
      <Link href={`/listings?${q.toString()}`} className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>{label}</Link>
    );
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight">전체 매물 · 투자분석</h1>
          <span className="font-mono text-xs text-gray-400">{data.asOf} · 네이버 {data.count.toLocaleString()}건 수집</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600">
          네이버 수집 전 매물을 <b>매수→2년 실거주→전세 전환</b> 시나리오로 분석해 점수 순으로 보여줍니다. 카드를 펼치면 계산 전 과정이 나옵니다.
        </p>
      </header>

      <DecisionFlow current={2} />
      <ProfileBadge />
      <MethodologyNote current="/listings" />

      {/* 필터 */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-gray-400">서울</span>
          {chip('전체', { gu: '' }, !sp.gu)}
          {gus.filter((g) => !isGyeonggi(g)).map((g) => chip(g, { gu: g }, sp.gu === g))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-gray-400">경기</span>
          {gus.filter(isGyeonggi).length === 0
            ? <span className="text-[11px] text-gray-400">수집 대기(다음 스윕 후 표시)</span>
            : gus.filter(isGyeonggi).map((g) => chip(g, { gu: g }, sp.gu === g))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-gray-400">금액대</span>
          {PRICE_BANDS.map((b) => chip(b.label, { band: sp.band === b.key ? '' : b.key }, sp.band === b.key))}
          <span className="ml-2 mr-1 text-[11px] font-semibold text-gray-400">면적</span>
          {['50㎡대', '60~74㎡', '84㎡급', '90㎡+'].map((a) => chip(a, { area: sp.area === a ? '' : a }, sp.area === a))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-gray-400">페르소나</span>
          {Object.entries(LISTING_PERSONAS).map(([k, p]) => chip(p.label, { persona: sp.persona === k ? '' : k }, sp.persona === k))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold text-gray-400">예산</span>
          {chip('오늘 가능', { feasible: sp.feasible === 'today' ? '' : 'today' }, sp.feasible === 'today')}
          {chip('2년후 가능', { feasible: sp.feasible === '2yr' ? '' : '2yr' }, sp.feasible === '2yr')}
          <span className="ml-2 mr-1 text-[11px] font-semibold text-gray-400">정렬{persona ? '(페르소나 우선)' : ''}</span>
          {chip('종합점수', { sort: 'score' }, !persona && sort === 'score')}
          {chip('ROE', { sort: 'roe' }, !persona && sort === 'roe')}
          {chip('가격', { sort: 'price' }, !persona && sort === 'price')}
          {chip('전세가율', { sort: 'jeonse' }, !persona && sort === 'jeonse')}
          {chip('통근시간', { sort: 'commute' }, !persona && sort === 'commute')}
        </div>
        {persona && (
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-[13px] leading-relaxed text-indigo-900">
            {persona.label} — {persona.desc}. <span className="text-indigo-400">정렬 규칙은 표시된 원천 수치로 검증 가능하며 판단을 대신하지 않습니다.</span>
          </p>
        )}
      </div>

      <div className="mb-3 space-y-1 text-[13px] leading-relaxed text-gray-600">
        <p>
          매물 <b className="text-gray-900">{totalListings.toLocaleString()}건</b> → 단지 <b className="text-gray-900">{groups.length.toLocaleString()}곳</b> 중 상위 {shown.length}곳
          <span className="text-gray-400"> — 같은 단지는 대표매물 하나로 묶었고, 펼치면 개별 매물이 나옵니다.</span>
        </p>
        <p className="text-xs text-gray-500">
          🚇 통근 기준 <b className="text-gray-700">{(ctx && !ctx.isDefault ? ctx.work.label : data.work?.label) ?? '전문건설회관'}</b>
          {(ctx && !ctx.isDefault ? ctx.purposeLive : data.work?.purposeLive) ? ' · 실거주 모드(통근 16%·상권 7% 가중)' : ' · 투자 모드(통근·상권은 참고 표시)'}
          {' · '}<Link href="/settings" className="font-medium text-blue-600 hover:underline">설정에서 변경</Link>
        </p>
      </div>

      <div className="space-y-2">
        {shown.map((g) => { const r = g.rep; return (
          <details key={g.key} className="group rounded-xl border border-gray-200 bg-white open:shadow-md">
            <summary className="flex cursor-pointer list-none items-center gap-3.5 px-4 py-3.5 sm:gap-4">
              <span className="shrink-0 text-center">
                <span className={`block font-mono text-2xl font-bold tabular-nums leading-none ${scoreColor(r.a.totalScore)}`}>{r.a.totalScore}</span>
                <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-gray-400">점수</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="text-[15px] leading-tight text-gray-900">{r.complexName}</b>
                  {g.items.length > 1 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">매물 {g.items.length}건</span>}
                  <CompareToggle complexNo={r.complexNo} name={r.complexName} />
                </span>
                <span className="mt-1 block text-xs text-gray-500">
                  {r.gu} {r.dong}{r.elapsedYear != null ? ` · ${r.elapsedYear}년차` : ''}{r.household ? ` · ${r.household.toLocaleString()}세대` : ''}
                </span>
                <span className="mt-1.5 block h-1.5 w-full max-w-[180px]"><ScoreBar score={r.a.totalScore} /></span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-base font-bold tabular-nums text-gray-900">{eok(r.price)}</span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  {g.items.length > 1
                    ? `${eok(g.minPrice)} ~ ${eok(g.maxPrice)} · ${g.minArea != null ? (Math.round(g.minArea!) === Math.round(g.maxArea!) ? `${Math.round(g.minArea!)}㎡` : `${Math.round(g.minArea!)}~${Math.round(g.maxArea!)}㎡`) : '면적 미상'}`
                    : `${r.area ?? '?'}㎡ · ${r.floor ?? '?'}${r.dir ? ` · ${r.dir}` : ''}`}
                </span>
              </span>
              <span className="hidden shrink-0 space-y-1 text-right sm:block">
                <span className={`block font-mono text-[13px] font-semibold tabular-nums ${r.a.base.roeAnnualPct >= 4 ? 'text-emerald-600' : r.a.base.roeAnnualPct >= 0 ? 'text-gray-600' : 'text-red-500'}`}>ROE {r.a.base.roeAnnualPct}%</span>
                <span className="block text-xs tabular-nums text-gray-500">전세 {r.jeonseRatioPct}%{r.jeonseEstimated ? '~' : ''}</span>
                {r.cm && <span className={`block text-xs font-medium tabular-nums ${r.cm.totalMin <= 40 ? 'text-emerald-600' : r.cm.totalMin <= 55 ? 'text-gray-500' : 'text-red-400'}`}>🚇 {r.cm.totalMin}분 · 환승{r.cm.transfers}</span>}
              </span>
              <span className="shrink-0 text-gray-300 transition group-open:rotate-90">▸</span>
            </summary>

            {/* 3단 투자분석(대표매물 기준): ① 판단근거 → ② 추론과정 → ③ 점수산출 */}
            <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
              {/* 그룹 개별 매물(네이버식 펼침) */}
              {g.items.length > 1 && (
                <div className="mb-4">
                  <div className="mb-1.5 text-[13px] font-bold text-gray-800">이 단지 매물 {g.items.length}건</div>
                  <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white">
                    <table className="w-full min-w-[620px] text-xs">
                      <thead>
                        <tr className="border-b bg-blue-50/60 text-left text-blue-900">
                          <th className="px-3 py-2 font-semibold">#</th>
                          <th className="px-3 py-2 text-right font-semibold">호가</th>
                          <th className="px-3 py-2 font-semibold">동/층/향</th>
                          <th className="px-3 py-2 font-semibold">면적</th>
                          <th className="px-3 py-2 font-semibold">등록일</th>
                          <th className="px-3 py-2 text-right font-semibold">점수</th>
                          <th className="px-3 py-2 text-right font-semibold">ROE</th>
                          <th className="px-3 py-2 text-right font-semibold">필요자본</th>
                          <th className="px-3 py-2 font-semibold">링크</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((it, j) => (
                          <tr key={j} className={`border-b last:border-0 ${j === 0 ? 'bg-blue-50/40 font-semibold' : ''}`}>
                            <td className="px-3 py-2 text-gray-500">{j === 0 ? '대표' : j + 1}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-900">{eok(it.price)}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-gray-700">{it.unitDong ? `${it.unitDong}동 ` : ''}{it.floor ?? '?'}{it.dir ? ` ${it.dir}` : ''}</td>
                            <td className="px-3 py-2 font-mono text-gray-600">{it.area ?? '?'}㎡</td>
                            <td className="px-3 py-2 text-gray-500">{it.listedDate ?? `수집 ${it.sweptAt}`}</td>
                            <td className={`px-3 py-2 text-right font-mono font-bold tabular-nums ${scoreColor(it.a.totalScore)}`}>{it.a.totalScore}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{it.a.base.roeAnnualPct}%</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-gray-700">{eok(it.a.equityIn)}</td>
                            <td className="px-3 py-2"><a href={naverArticleUrl(it)} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">{it.articleNo ? '매물 ↗' : '단지 ↗'}</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <InvestBreakdown d={{
                priceManwon: r.price, jeonseRatioPct: r.jeonseRatioPct, jeonseEstimated: r.jeonseEstimated,
                tradeCount: r.tradeCount, latestTradeDate: r.latestTradeDate, tradeMedian: r.tradeMedian,
                elapsedYear: r.elapsedYear, household: r.household,
                usableToday: r.a.usableToday, projected2yr: r.a.projected2yr, loanRatePct: data.model.loanRatePct,
                loan: r.a.loan, equityIn: r.a.equityIn, ltvLoan: r.a.ltvLoan, dsrLoanCap: r.a.dsrLoanCap, bindingCap: r.a.bindingCap,
                feasibleToday: r.a.feasibleToday, feasible2yr: r.a.feasible2yr,
                monthlyPayment: r.a.monthlyPayment, interest2yr: r.a.interest2yr, acqTaxNet: r.a.acqTaxNet, propertyTax2yr: r.a.propertyTax2yr, holdingCost: r.a.holdingCost, remainingLoan: r.a.remainingLoan,
                base: r.a.base, conservativeRoe: r.a.conservative.roeAnnualPct, optimisticRoe: r.a.optimistic.roeAnnualPct,
                jeonseDeposit: r.a.jeonseDeposit, loanCleared: r.a.loanCleared, cashReleased: r.a.cashReleased, interestReductionPct: r.a.interestReductionPct, wolseNetMonthly: r.a.wolseNetMonthly,
                breakevenApprPct: r.a.breakevenApprPct, altVerdict: r.a.altVerdict,
                scores: r.a.scores, totalScore: r.a.totalScore,
                commuteText: r.cm ? `${r.cm.station}(${r.cm.lines}) 도보 ${r.cm.walkMin}분 → ${r.cm.transfers}회 환승 → 총 ~${r.cm.totalMin}분 · 자차 ~${r.cm.driveMin}분(${r.cm.driveReal ? '카카오 실경로' : `직선 ${r.cm.straightKm}km 근사`})${r.cm.busDependent ? ' · ⚠️ 역 1.2km+ 버스 의존' : ''} · 1km 내 역 ${r.am?.stationsIn1km ?? '?'}개` : null,
                workLabel: r.cm?.workLabel,
              }} />
              {r.vs && (
                <div className={`mt-4 rounded-lg px-4 py-3 text-[13px] leading-relaxed ${r.vs.winner === 'APT' ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100' : 'bg-blue-50 text-blue-900 ring-1 ring-blue-100'}`}>
                  <div className="font-bold">🏁 10년 장기 — 집 vs S&amp;P500 ETF({r.vs.rPct}%): {r.vs.winner === 'APT' ? '🏠 매수 우위' : '📈 ETF 우위'}</div>
                  <div className="mt-1">10년 후 매수 <b>{eok(r.vs.a10)}</b> vs ETF <b>{eok(r.vs.b10)}</b> · 손익분기 상승률 <b>{r.vs.gStar}%/년</b></div>
                  <div className="mt-1 text-xs text-gray-500">이 지역 가정 {r.a.base.apprPct}% · 전환 후 동급 전세 재진입 기준 · 상세 <Link href="/versus" className="underline">집vs주식</Link></div>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                <Link href={`/complex/${r.complexNo}`} className="rounded-full bg-gray-900 px-3 py-1 font-semibold text-white hover:bg-gray-700">📋 단지 종합 프로필 →</Link>
                <span>대표매물 {r.listedDate ? `등록 ${r.listedDate}` : `수집 ${r.sweptAt}`}{r.unitDong ? ` · ${r.unitDong}동` : ''}</span>
                <span>최근 실거래 {r.latestTradeDate ?? '—'} · 180일 {r.tradeCount}건</span>
                <a href={naverArticleUrl(r)} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">{r.articleNo ? '네이버 매물 ↗' : '네이버 단지 매물탭 ↗'}</a>
              </div>
            </div>
          </details>
        ); })}
      </div>

      <CompareBar />
      <footer className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-400">
        생성 {new Date(data.generatedAt).toLocaleString('ko-KR')} · 재생성 <code className="rounded bg-gray-100 px-1 py-0.5">npx tsx scripts/gen-listings.ts</code> · 모델 config/investment-model.json · 추적 3단지 상세는 <Link href="/matching" className="text-blue-500 hover:underline">매수 분석</Link>
      </footer>
    </main>
  );
}
