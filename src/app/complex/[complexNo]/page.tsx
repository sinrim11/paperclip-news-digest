/**
 * /complex/[complexNo] — 단지 종합 프로필: 수집된 모든 데이터를 한 화면에.
 *   기본정보(연식·세대·용적률·재건축 판정) · 레이더 지수 · 실거래/전세 이력 · 현재 호가 매물
 *   · 통근·상권(카카오 실데이터) · 3단 투자분석(활성 프로필 기준) · 10년 집vs주식 · 정성 팩트·출처.
 */
import Link from 'next/link';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { LAWD_GU } from '@/lib/tiers';
import { resolveContext, PROFILE_COOKIE } from '@/lib/profiles';
import { regionApprPct } from '@/lib/investment-model';
import { analyzeWithVersus, listingsCompact } from '@/lib/invest-compact';
import { computeCommute, computeAmenity, computeAmenityKakao, lineLabel, type KakaoCtx } from '@/lib/commute';
import { radarScore, RADAR_PART_META } from '@/lib/radar-score';
import InvestBreakdown from '@/components/InvestBreakdown';
import ProfileBadge from '@/components/ProfileBadge';
import DecisionFlow from '@/components/DecisionFlow';
import { CompareToggle, CompareBar } from '@/components/CompareControls';
import { buildRisks, buildBuyCase } from '@/lib/complex-summary';
import { momentumFor } from '@/lib/momentum';
import { tradeTrendFlag, DEFAULT_DOWNSIDE } from '@/lib/downside';
import { RichText } from '@/components/RichText';

export const dynamic = 'force-dynamic';

const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';
const normName = (s: string) => s.replace(/\s|아파트|아파트$/g, '');
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

interface ListingItem { price: number; exclusiveArea: number | null; floor: string | null; dong: string | null; confirmDate?: string | null; direction?: string | null; articleNo?: number | null }
interface Fact { match: { gu: string; dong?: string; nameIncludes: string }; station?: string; catalyst?: string; school?: string; amenities?: string; living?: string; reasons?: string[]; cautions?: string[]; sources?: string[] }

function loadJson<T>(rel: string): T | null {
  try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')) as T; } catch { return null; }
}
const srcHref = (s: string) => (/^https?:\/\//.test(s) ? s : `https://${s}`);

export default async function ComplexPage({ params }: { params: Promise<{ complexNo: string }> }) {
  const { complexNo } = await params;
  const c = await prisma.complexCandidate.findUnique({ where: { complexNo } });
  if (!c) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-bold">단지를 찾을 수 없습니다</h1>
        <p className="mt-3 text-sm text-gray-500">단지번호 {complexNo} — 수집 대상(서울 13개 구·예산 스윕)이 아닐 수 있습니다. <Link href="/listings" className="text-blue-600 hover:underline">전체 매물로 →</Link></p>
      </main>
    );
  }

  const cookieStore = await cookies();
  const ctx = resolveContext(cookieStore.get(PROFILE_COOKIE)?.value);

  // ── 실거래·전세 이력(180일, lawd+dong+정규화 이름 매칭 — gen-listings와 동일 규칙) ──
  const guToLawd: Record<string, string> = {};
  for (const [lawd, gu] of Object.entries(LAWD_GU)) if (!guToLawd[gu]) guToLawd[gu] = lawd;
  const lawd = guToLawd[c.gu];
  const since = new Date(Date.now() - 180 * 86_400_000);
  const nm = normName(c.name);
  const [tradesAll, rentsAll] = await Promise.all([
    lawd ? prisma.aptTrade.findMany({ where: { lawdCd: lawd, dong: c.dong, dealDate: { gte: since } }, orderBy: { dealDate: 'desc' } }) : [],
    lawd ? prisma.aptRent.findMany({ where: { lawdCd: lawd, dong: c.dong, dealDate: { gte: since } }, orderBy: { dealDate: 'desc' } }) : [],
  ]);
  const match = (n: string) => { const x = normName(n); return x === nm || x.includes(nm) || nm.includes(x); };
  const trades = tradesAll.filter((t) => match(t.aptName));
  const rents = rentsAll.filter((r) => match(r.aptName));
  const jeonse = rents.filter((r) => r.monthlyRent === 0);

  const tradeMedian = trades.length ? median(trades.map((t) => t.dealAmount)) : null;
  const jeonseMedian = jeonse.length >= 2 ? median(jeonse.map((r) => r.deposit)) : null;
  const jeonseRatioPct = jeonseMedian && tradeMedian ? Math.round((jeonseMedian / tradeMedian) * 100) : null;
  const gapPct = tradeMedian && c.minDealPrice ? +(((c.minDealPrice - tradeMedian) / tradeMedian) * 100).toFixed(1) : null;

  // 면적대별 실거래 요약
  const bandOf = (a: number) => (a < 50 ? '~50㎡' : a < 60 ? '50㎡대' : a < 75 ? '60~74㎡' : a < 90 ? '84㎡급' : '90㎡+');
  const bands = new Map<string, number[]>();
  for (const t of trades) { const b = bandOf(t.excluUseAr); (bands.get(b) ?? bands.set(b, []).get(b)!).push(t.dealAmount); }

  // ── 레이더 지수(공유용 객관 지표 — 카드뉴스와 동일 공식) ──
  const radar = radarScore({
    household: c.household, elapsedYear: c.elapsedYear, far: c.far ?? null,
    dealArticles: c.dealArticles, gapPct, jeonseRatioPct, tradeCount: trades.length,
  });

  // ── 통근·상권(카카오 실데이터 + 좌표 근사) ──
  const kakaoAll = loadJson<{ workKey: string; complexes: Record<string, KakaoCtx> }>('config/kakao-context.json');
  const workKey = ctx ? `${ctx.work.lat.toFixed(5)},${ctx.work.lng.toFixed(5)}` : '';
  const kc0 = kakaoAll?.complexes?.[complexNo] ?? null;
  const kc = kc0 && kakaoAll && kakaoAll.workKey !== workKey ? { ...kc0, driveMin: null, driveKm: null } : kc0;
  const cm = ctx && c.lat != null && c.lng != null ? computeCommute(c.lat, c.lng, ctx.work, kc) : null;
  const am = c.lat != null && c.lng != null
    ? (kc?.counts ? computeAmenityKakao(kc.counts, kc.subway?.distanceM ?? null, c.lat, c.lng) : computeAmenity(c.lat, c.lng, c.household))
    : null;

  // ── 3단 투자분석(활성 프로필) + 10년 vs ──
  const regionHeat = (loadJson<any>('config/market-context.json')?.regionHeat ?? {}) as Record<string, number>;
  const price = c.minDealPrice ?? tradeMedian ?? null;
  let breakdown = null as ReturnType<typeof listingsCompact> | null;
  let vs: { gStar: number; winner: string; a10: number; b10: number; rPct: number } | null = null;
  if (ctx && price) {
    const r = analyzeWithVersus({
      priceManwon: price, jeonseRatioPct: jeonseRatioPct ?? 65, tradeCount: trades.length,
      elapsedYear: c.elapsedYear, household: c.household, apprBasePct: regionApprPct(ctx.model, regionHeat[c.gu]),
      purposeLive: ctx.purposeLive,
      commute: cm ? { score: cm.score, formula: cm.formula, basis: cm.basis } : null,
      amenity: am ? { score: am.score, formula: am.formula, basis: am.basis } : null,
    }, ctx.fin, ctx.params, ctx.model);
    breakdown = listingsCompact(r.a);
    vs = r.vs;
  }

  // ── 정성 팩트 ──
  const facts = (loadJson<Fact[]>('config/complex-facts.json') ?? []).find((f) => f.match.gu === c.gu && (!f.match.dong || f.match.dong === c.dong) && c.name.includes(f.match.nameIncludes));

  const listings = (c.listings as unknown as ListingItem[]) ?? [];
  const dirKo = (code?: string | null) => code ? String(code).split('').map((x) => (({ E: '동', W: '서', S: '남', N: '북' } as Record<string, string>)[x] ?? x)).join('') : null;
  const rebuild = c.elapsedYear != null && c.elapsedYear >= 30
    ? (c.far != null ? (c.far <= 180 ? { label: `재건축 사업성 양호 (용적률 ${Math.round(c.far)}%)`, cls: 'bg-emerald-100 text-emerald-700' } : c.far <= 230 ? { label: `재건축 관망 (용적률 ${Math.round(c.far)}%)`, cls: 'bg-amber-100 text-amber-800' } : { label: `재건축 기대 제한 (용적률 ${Math.round(c.far)}%)`, cls: 'bg-gray-200 text-gray-600' }) : { label: '재건축 연한 진입', cls: 'bg-amber-100 text-amber-800' })
    : null;

  // ── 리스크(반대 근거) 자동 추출 — 비교 페이지와 동일 규칙 ──
  const risks = buildRisks({
    complexNo: c.complexNo, name: c.name, gu: c.gu, dong: c.dong,
    household: c.household, elapsedYear: c.elapsedYear, far: c.far ?? null,
    minPrice: c.minDealPrice, maxPrice: c.maxDealPrice, dealArticles: c.dealArticles, sweptAt: c.sweptAt.toISOString().slice(0, 10),
    tradeMedian, tradeCount: trades.length, latestTradeDate: trades[0]?.dealDate.toISOString().slice(0, 10) ?? null,
    jeonseMedian, jeonseRatioPct, jeonseCount: jeonse.length, gapPct, radar, rebuild: null,
    commute: cm ? { station: cm.origin.name, lines: '', walkMin: cm.origin.walkMin, transfers: cm.transfers, totalMin: cm.totalMin, driveMin: cm.driveMin, driveReal: cm.driveReal, busDependent: cm.busDependent } : null,
    amenity: am ? { score: am.score, counts: null } : null,
    invest: breakdown ? { totalScore: breakdown.totalScore, roeAnnualPct: breakdown.base.roeAnnualPct, equityIn: breakdown.equityIn, feasibleToday: breakdown.feasibleToday, feasible2yr: breakdown.feasible2yr, breakevenApprPct: breakdown.breakevenApprPct } : null,
    vs,
  });
  // 하방 경고 플래그(2-B) — 거래량 추세 급감은 UI에 항상 표시(숨김 금지)
  const trendFlag = tradeTrendFlag(trades.map((t) => t.dealDate.getTime()), 180, Date.now(), DEFAULT_DOWNSIDE);
  if (trendFlag) risks.push(`🚩 ${trendFlag.label}`);

  // 🎯 매수 케이스(설득 논리 + 자기검증) — 시스템 스스로 설득 안 되면 '추천 보류'
  const buyCase = buildBuyCase({
    complexNo: c.complexNo, name: c.name, gu: c.gu, dong: c.dong,
    household: c.household, elapsedYear: c.elapsedYear, far: c.far ?? null,
    minPrice: c.minDealPrice, maxPrice: c.maxDealPrice, dealArticles: c.dealArticles, sweptAt: c.sweptAt.toISOString().slice(0, 10),
    tradeMedian, tradeCount: trades.length, latestTradeDate: trades[0]?.dealDate.toISOString().slice(0, 10) ?? null,
    jeonseMedian, jeonseRatioPct, jeonseCount: jeonse.length, gapPct, radar,
    rebuild: rebuild ? { label: rebuild.label, good: rebuild.cls.includes('emerald') } : null,
    commute: cm ? { station: cm.origin.name, lines: '', walkMin: cm.origin.walkMin, transfers: cm.transfers, totalMin: cm.totalMin, driveMin: cm.driveMin, driveReal: cm.driveReal, busDependent: cm.busDependent } : null,
    amenity: am ? { score: am.score, counts: null } : null,
    invest: breakdown ? { totalScore: breakdown.totalScore, roeAnnualPct: breakdown.base.roeAnnualPct, equityIn: breakdown.equityIn, feasibleToday: breakdown.feasibleToday, feasible2yr: breakdown.feasible2yr, breakevenApprPct: breakdown.breakevenApprPct } : null,
    vs, risks,
  });

  // 💸 월 부담 명세(만원) — "이 집을 사면 매달 얼마 나가나"
  const monthly = breakdown && ctx ? (() => {
    const interest = (breakdown.loan * ctx.model.loanRatePct) / 100 / 12;
    const principal = breakdown.monthlyPayment - interest;
    const propertyTax = breakdown.propertyTax2yr / 24;
    const existingLoan = (ctx.fin.existingLoanMonthly ?? 0) / 10000;
    const total = breakdown.monthlyPayment + propertyTax + existingLoan;
    const saved = (ctx.fin.jeonseLoanInterestMonthly ?? 0) / 10000;
    const incomeNet = (ctx.fin.cashflow?.monthlyIncomeNet ?? 0) / 10000;
    return { payment: Math.round(breakdown.monthlyPayment), interest: Math.round(interest), principal: Math.round(principal), propertyTax: Math.round(propertyTax * 10) / 10, existingLoan: Math.round(existingLoan), total: Math.round(total), saved: Math.round(saved), netIncrease: Math.round(total - saved), incomeNet: Math.round(incomeNet), burdenPct: incomeNet > 0 ? Math.round((total / incomeNet) * 100) : 0 };
  })() : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <DecisionFlow current={4} />
      {/* ── 헤더 ── */}
      <header className="mb-5">
        <div className="text-xs text-gray-400"><Link href="/listings" className="hover:underline">전체 매물</Link> / {c.gu} {c.dong}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-3xl font-bold tracking-tight">{c.name}</h1>
          <span className="rounded-full bg-gray-900 px-3 py-1 font-mono text-sm font-bold text-white">레이더 {radar.score}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${buyCase.verdict === '추천 가능' ? 'bg-emerald-600 text-white' : buyCase.verdict === '조건부 추천' ? 'bg-amber-500 text-white' : 'bg-red-100 text-red-700'}`}>{buyCase.verdict}</span>
          {rebuild && <span className={`rounded-full px-3 py-1 text-xs font-bold ${rebuild.cls}`}>{rebuild.label}</span>}
          <CompareToggle complexNo={c.complexNo} name={c.name} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
          <span>{c.gu} {c.dong}</span>
          <span>· {c.household.toLocaleString()}세대</span>
          {c.elapsedYear != null && <span>· {c.elapsedYear}년차{c.approvalDate ? `(${c.approvalDate.slice(0, 4)}년 준공)` : ''}</span>}
          {c.far != null && <span>· 용적률 <b className={c.far <= 180 ? 'text-emerald-600' : 'text-gray-800'}>{Math.round(c.far)}%</b></span>}
          <a href={`https://fin.land.naver.com/complexes/${c.complexNo}?tab=article`} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">네이버 ↗</a>
          {c.lat != null && <a href={`https://map.kakao.com/link/map/${encodeURIComponent(c.name)},${c.lat},${c.lng}`} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">카카오맵 ↗</a>}
        </div>
      </header>

      <ProfileBadge />

      {/* ── ❓ 한눈에 Q&A — 초보의 5가지 질문에 데이터로 즉답(3-C, Phase 0 확정 스펙) ── */}
      <section className="mb-6 rounded-xl border border-gray-300 bg-white p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">❓ 한눈에 Q&A</h2>
          <span className="text-xs text-gray-400">궁금한 것부터 — 각 답은 아래 상세 섹션의 원천 데이터 요약(참고자료, 판단은 본인)</span>
        </div>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {/* Q1 가격 */}
          <a href="#trades" className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-400">
            <div className="text-[13px] font-semibold text-gray-500">지금 호가, 실거래 대비 비싼가?</div>
            {gapPct == null ? (
              <><div className="mt-1 text-lg font-bold text-red-600">판정 불가</div>
              <div className="mt-0.5 text-xs text-gray-500">180일 실거래 표본 없음 — 호가만 존재</div></>
            ) : (
              <><div className={`mt-1 font-mono text-lg font-bold tabular-nums ${gapPct <= 2 ? 'text-emerald-600' : gapPct > 8 ? 'text-red-600' : 'text-amber-600'}`}>{gapPct >= 0 ? '+' : ''}{gapPct}% {gapPct <= 2 ? '— 시세 수준' : gapPct > 8 ? '— 높음, 협상 필수' : '— 다소 높음'}</div>
              <div className="mt-0.5 text-xs text-gray-500">최저 호가 {c.minDealPrice ? eok(c.minDealPrice) : '-'} vs 실거래 중간 {tradeMedian ? eok(tradeMedian) : '-'}({trades.length}건·국토부) ↓</div></>
            )}
          </a>
          {/* Q2 월 부담 */}
          <a href="#monthly" className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-400">
            <div className="text-[13px] font-semibold text-gray-500">사면 매달 얼마 나가나?</div>
            {monthly ? (
              <><div className="mt-1 font-mono text-lg font-bold tabular-nums text-gray-900">약 {monthly.total.toLocaleString()}만/월</div>
              <div className="mt-0.5 text-xs text-gray-500">실수령의 {monthly.burdenPct}% · 현 주거비 대비 +{monthly.netIncrease}만 (금리 {ctx?.model.loanRatePct}%·30년) ↓</div></>
            ) : (
              <><div className="mt-1 text-lg font-bold text-gray-400">계산 불가</div>
              <div className="mt-0.5 text-xs text-gray-500">기준가(호가·실거래) 또는 프로필 없음</div></>
            )}
          </a>
          {/* Q3 교통 */}
          <a href="#commute" className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-400">
            <div className="text-[13px] font-semibold text-gray-500">역까지 도보 몇 분, 회사까진?</div>
            {cm ? (
              <><div className="mt-1 text-lg font-bold text-gray-900">{cm.origin.name} 도보 {cm.origin.walkMin}분{cm.busDependent ? ' ⚠️' : ''}</div>
              <div className="mt-0.5 text-xs text-gray-500">{ctx?.work.label}까지 총 ~{cm.totalMin}분 · 자차 ~{cm.driveMin}분{cm.driveReal ? '(카카오 실경로)' : '(근사)'}{cm.busDependent ? ' · 역 1.2km+ 버스 의존' : ''} ↓</div></>
            ) : (
              <><div className="mt-1 text-lg font-bold text-gray-400">실측 없음</div>
              <div className="mt-0.5 text-xs text-gray-500">좌표 미수집 — 다음 스윕 백필 대기</div></>
            )}
          </a>
          {/* Q4 편의 */}
          <a href="#commute" className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-400">
            <div className="text-[13px] font-semibold text-gray-500">마트·병원 근처에 있나?</div>
            {kc?.counts ? (
              <><div className="mt-1 text-lg font-bold text-gray-900">마트 {kc.counts.mart ?? 0} · 병원 {kc.counts.hospital ?? 0}</div>
              <div className="mt-0.5 text-xs text-gray-500">1km 실측(카카오) · 편의점 {kc.counts.convenience ?? 0}·약국 {kc.counts.pharmacy ?? 0}(500m) ↓</div></>
            ) : (
              <><div className="mt-1 text-lg font-bold text-gray-400">실측 없음</div>
              <div className="mt-0.5 text-xs text-gray-500">카카오 상권 데이터 미수집</div></>
            )}
          </a>
          {/* Q5 유동성 */}
          <a href="#trades" className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-400">
            <div className="text-[13px] font-semibold text-gray-500">팔고 싶을 때 팔리는 단지인가?</div>
            <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${trades.length >= 10 ? 'text-emerald-600' : trades.length >= 3 ? 'text-gray-900' : 'text-red-600'}`}>180일 {trades.length}건 거래</div>
            <div className="mt-0.5 text-xs text-gray-500">{c.household.toLocaleString()}세대 · 현재 매물 {c.dealArticles}건 — {trades.length >= 10 ? '유동성 검증' : trades.length >= 3 ? '보통' : '표본 부족·환금 의문'} ↓</div>
          </a>
          {/* Q6 리스크 */}
          <a href="#risks" className="rounded-lg border border-gray-200 p-3 transition hover:border-gray-400">
            <div className="text-[13px] font-semibold text-gray-500">이 단지의 리스크는?</div>
            {risks.length === 0 ? (
              <><div className="mt-1 text-lg font-bold text-emerald-600">감지 없음</div>
              <div className="mt-0.5 text-xs text-gray-500">데이터 기준 — 현장·등기 확인은 필수 ↓</div></>
            ) : (
              <><div className="mt-1 text-lg font-bold text-red-600">{risks.length}건 감지</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{risks[0]}{risks.length > 1 ? ` 외 ${risks.length - 1}건` : ''} ↓</div></>
            )}
          </a>
        </div>
      </section>

      {/* ── 히어로 스탯 ── */}
      <section className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          ['최저 호가', c.minDealPrice ? eok(c.minDealPrice) : '-', `매매 매물 ${c.dealArticles}건 · 수집 ${c.sweptAt.toISOString().slice(0, 10)}`, 'text-blue-700'],
          ['실거래 중간(180일)', tradeMedian ? eok(tradeMedian) : '표본 없음', trades.length ? `${trades.length}건 · 최근 ${trades[0]?.dealDate.toISOString().slice(0, 10)}` : '거래 없음', 'text-gray-900'],
          ['호가 갭', gapPct != null ? `${gapPct >= 0 ? '+' : ''}${gapPct}%` : '-', '최저호가 vs 실거래 중간', gapPct != null && gapPct <= 2 ? 'text-emerald-600' : gapPct != null && gapPct > 10 ? 'text-red-600' : 'text-gray-900'],
          ['전세 중간·전세가율', jeonseMedian ? `${eok(jeonseMedian)} · ${jeonseRatioPct}%` : '표본 부족', `전세 계약 ${jeonse.length}건(180일)`, 'text-purple-700'],
        ].map(([k, v, s, cls]) => (
          <div key={k as string} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{k}</div>
            <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${cls}`}>{v}</div>
            <div className="mt-1 text-xs text-gray-500">{s}</div>
          </div>
        ))}
      </section>

      {/* ── 레이더 지수(공유용 객관 지표) ── */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">레이더 지수 <span className="font-mono">{radar.score}</span><span className="text-sm font-normal text-gray-400">/100</span></h2>
          <span className="text-xs text-gray-400">공개 데이터 4지표 — 개인 예산·통근 무관(카드뉴스와 동일 공식)</span>
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full">
          {RADAR_PART_META.map((m) => (
            <div key={m.key} className="relative bg-gray-200" style={{ width: `${m.max}%`, borderRight: '2px solid #fff' }}>
              <div className="absolute inset-y-0 left-0" style={{ width: `${(radar.parts[m.key as keyof typeof radar.parts] / m.max) * 100}%`, background: m.color }} />
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gray-600">
          {RADAR_PART_META.map((m) => (
            <span key={m.key}><span className="mr-1.5 inline-block h-3 w-3 rounded" style={{ background: m.color }} />{m.label} <b className="font-mono">{radar.parts[m.key as keyof typeof radar.parts]}</b><span className="text-gray-400">/{m.max}</span></span>
          ))}
        </div>
        {radar.facts.length > 0 && (
          <ul className="mt-3 space-y-1 text-[13px] leading-relaxed text-gray-700">
            {radar.facts.map((f, i) => <li key={i}>✓ <RichText text={f} /></li>)}
          </ul>
        )}
      </section>

      {/* ── 💸 이 집을 사면 — 월 부담 명세(임장 전 필수 확인) ── */}
      {monthly && (
        <section id="monthly" className="mb-6 scroll-mt-4 rounded-xl border-2 border-gray-800 bg-white p-4">
          <h2 className="text-lg font-bold">💸 이 집을 사면 — 월 부담 명세 <span className="text-sm font-normal text-gray-400">기준가 {price ? eok(price) : '-'} · 대출 {breakdown ? eok(breakdown.loan) : '-'} · 금리 {ctx?.model.loanRatePct}%</span></h2>
          <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <div className="rounded-lg bg-gray-900 p-3 text-white">
              <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">총 월 부담</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{monthly.total.toLocaleString()}만<span className="text-sm font-normal text-gray-400">/월</span></div>
              <div className="mt-1 text-xs text-gray-400">실수령 {monthly.incomeNet.toLocaleString()}만의 <b className="text-white">{monthly.burdenPct}%</b></div>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">원리금</div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums">{monthly.payment.toLocaleString()}만</div>
              <div className="mt-1 text-xs leading-snug text-gray-500">이자 {monthly.interest}만(비용) + 원금 {monthly.principal}만(자산화)</div>
            </div>
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">보유세·기타</div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums">{monthly.propertyTax}만</div>
              <div className="mt-1 text-xs leading-snug text-gray-500">재산세 월환산{monthly.existingLoan > 0 ? ` + 기존대출 ${monthly.existingLoan}만` : ''} · 관리비는 현장 확인</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-600">현 주거비 대비</div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-700">+{monthly.netIncrease.toLocaleString()}만/월</div>
              <div className="mt-1 text-xs leading-snug text-gray-500">전세대출이자 {monthly.saved}만 소멸 반영 · 순수 추가 부담</div>
            </div>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-gray-500">※ 이자만 비용이고 원금 {monthly.principal}만은 내 자산으로 쌓입니다 — 순수 소멸 비용은 월 약 <b className="text-gray-700">{(monthly.interest + monthly.propertyTax).toLocaleString()}만</b>(이자+보유세). 2년 실거주 후 전세 전환 시 원리금 부담이 사라지는 구조는 아래 투자분석 참조.</p>
        </section>
      )}

      {/* ── 🎯 매수 케이스 — 시스템의 설득 논리와 자기검증 ── */}
      <section className={`mb-6 rounded-xl border p-4 ${buyCase.verdict === '추천 가능' ? 'border-emerald-200 bg-emerald-50/40' : buyCase.verdict === '조건부 추천' ? 'border-amber-200 bg-amber-50/40' : 'border-red-200 bg-red-50/40'}`}>
        <h2 className="text-lg font-bold">🎯 매수 케이스 <span className={`ml-1 rounded-full px-2.5 py-0.5 text-sm font-bold ${buyCase.verdict === '추천 가능' ? 'bg-emerald-600 text-white' : buyCase.verdict === '조건부 추천' ? 'bg-amber-500 text-white' : 'bg-red-600 text-white'}`}>{buyCase.verdict}</span> <span className="text-sm font-normal text-gray-400">설득력 {buyCase.strength}점 — 시스템이 스스로를 설득하는 논증과 그 약점</span></h2>
        {buyCase.argument.length > 0 && (
          <ol className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-gray-800">
            {buyCase.argument.map((a, i) => <li key={i} className="flex gap-2"><span className="font-bold text-gray-400">{i + 1}.</span><span><RichText text={a} /></span></li>)}
          </ol>
        )}
        {buyCase.selfCheck.length > 0 && (
          <div className="mt-3 rounded-lg bg-white/70 px-3 py-2.5">
            <b className="text-[13px] text-gray-700">🔍 자기검증 — 이 논증의 약점</b>
            <ul className="mt-1 space-y-1 text-[13px] leading-relaxed text-gray-600">
              {buyCase.selfCheck.map((s, i) => <li key={i}>· <RichText text={s} /></li>)}
            </ul>
          </div>
        )}
      </section>

      {/* ── 확인해야 할 리스크(반대 근거) — 균형 잡힌 판단용 ── */}
      <section id="risks" className="mb-6 scroll-mt-4 rounded-xl border border-red-200 bg-red-50/50 p-4">
        <h2 className="text-lg font-bold text-red-800">⚠️ 확인해야 할 리스크 <span className="text-sm font-normal text-red-400">데이터 기반 반대 근거 — 임장·판단 전 필독</span></h2>
        {risks.length === 0 ? (
          <p className="mt-2 text-[13px] text-gray-600">수집 데이터 기준 특이 리스크가 감지되지 않았습니다 — 그래도 현장·등기·관리비 확인은 필수입니다.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-red-900">
            {risks.map((r, i) => <li key={i}>· <RichText text={r} /></li>)}
          </ul>
        )}
      </section>

      {/* ── 통근·상권 ── */}
      {(cm || am) && (
        <section id="commute" className="mb-6 scroll-mt-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <h2 className="text-lg font-bold text-indigo-900">🚇 통근 · 상권</h2>
          {cm && (
            <p className="mt-2 text-[13px] leading-relaxed text-indigo-900">
              <b>{ctx?.work.label}</b>까지 — <RichText text={`${cm.origin.name}(${cm.origin.lines.map(lineLabel).join('·')}) 도보 ${cm.origin.walkMin}분 → ${cm.transfers}회 환승 → 총 ~${cm.totalMin}분 · 자차 ~${cm.driveMin}분${cm.driveReal ? '(카카오 실경로)' : '(근사)'}`} />
              {cm.busDependent && <span className="text-amber-700"> · ⚠️ 역 1.2km+ 버스 의존</span>}
            </p>
          )}
          {kc?.counts && (
            <div className="mt-3 grid grid-cols-4 gap-2 text-center sm:grid-cols-8">
              {([['편의점', 'convenience'], ['마트', 'mart'], ['음식점', 'food'], ['카페', 'cafe'], ['병원', 'hospital'], ['약국', 'pharmacy'], ['학원', 'academy'], ['학교', 'school']] as const).map(([label, key]) => (
                <div key={key} className="rounded-lg bg-white/70 px-2 py-2">
                  <div className="font-mono text-base font-bold tabular-nums text-indigo-900">{kc.counts![key] ?? 0}</div>
                  <div className="text-[11px] text-indigo-400">{label}</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-indigo-300">상권 개수: 카카오 로컬 API 실측(편의점·음식점·카페·약국 500m / 마트·병원·학원·학교 1km) · 지하철 소요는 좌표 근사</p>
        </section>
      )}

      {/* ── 🚧 지역 호재(모멘텀) — 확실성 등급·출처 명시(2-A) ── */}
      {(() => {
        const momentum = momentumFor(c.gu, c.dong);
        if (!momentum.length) return null;
        const badge = (cert: string) =>
          cert === '확정' ? 'bg-emerald-600 text-white' : cert === '진행' ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700';
        return (
          <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <h2 className="text-lg font-bold text-amber-900">🚧 지역 호재 <span className="text-sm font-normal text-amber-500">{c.gu}{c.dong ? ` ${c.dong}` : ''} — 확실성 등급·정부/공식 발표 근거</span></h2>
            <ul className="mt-2.5 space-y-2.5">
              {momentum.map((m) => (
                <li key={m.id} className="rounded-lg bg-white/80 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badge(m.certainty)}`}>{m.certainty}</span>
                    <b className="text-gray-900">{m.title}</b>
                    <span className="text-gray-500">{m.expected}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-gray-700">{m.detail}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">📎
                    {m.sourceUrls.map((s, i) => (
                      <a key={i} href={s} target="_blank" rel="noreferrer" className="rounded border border-gray-200 px-1.5 py-0.5 text-blue-500 hover:underline">{s.replace(/^https?:\/\//, '').split('/')[0]}</a>
                    ))}
                    <span>· 확인 {m.verifiedAt}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-xs leading-relaxed text-amber-700">※ <b>구상</b> 단계 호재는 점수·추천에 반영하지 않고 표시만 합니다. 개통 시기는 공식 목표 기준이며 지연이 흔합니다 — 호재를 매수가에 선반영하지 마세요.</p>
          </section>
        );
      })()}

      {/* ── 현재 호가 매물 ── */}
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-bold">현재 호가 매물 <span className="text-sm font-normal text-gray-400">{listings.length}건 (예산 스윕 수집 · {c.sweptAt.toISOString().slice(0, 10)})</span></h2>
        {listings.length === 0 ? <p className="rounded-lg border bg-white p-5 text-sm text-gray-500">수집된 예산 내 매물이 없습니다.</p> : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-semibold">#</th><th className="px-3 py-2 text-right font-semibold">호가</th>
                  <th className="px-3 py-2 font-semibold">면적</th><th className="px-3 py-2 font-semibold">동/층</th>
                  <th className="px-3 py-2 font-semibold">향</th><th className="px-3 py-2 font-semibold">등록일</th><th className="px-3 py-2 font-semibold">링크</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eok(l.price)}</td>
                    <td className="px-3 py-2 font-mono text-gray-600">{l.exclusiveArea ? `${Math.round(l.exclusiveArea)}㎡` : '?'}</td>
                    <td className="px-3 py-2 text-gray-700">{l.dong ? `${l.dong}동 ` : ''}{l.floor ?? '?'}</td>
                    <td className="px-3 py-2 text-gray-600">{dirKo(l.direction) ?? '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{l.confirmDate ?? '-'}</td>
                    <td className="px-3 py-2"><a href={l.articleNo ? `https://fin.land.naver.com/articles/${l.articleNo}` : `https://fin.land.naver.com/complexes/${c.complexNo}?tab=article`} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">{l.articleNo ? '매물 ↗' : '단지 ↗'}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 실거래 이력 ── */}
      <section id="trades" className="mb-6 scroll-mt-4">
        <h2 className="mb-2 text-lg font-bold">실거래 이력 <span className="text-sm font-normal text-gray-400">최근 180일 · {trades.length}건 (국토부)</span></h2>
        {bands.size > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {[...bands.entries()].sort((a, b) => median(a[1]) - median(b[1])).map(([b, arr]) => (
              <span key={b} className="rounded-full bg-gray-100 px-3 py-1 text-[13px] text-gray-700">{b} 중간 <b className="font-mono">{eok(median(arr))}</b> · {arr.length}건</span>
            ))}
          </div>
        )}
        {trades.length === 0 ? <p className="rounded-lg border bg-white p-5 text-sm text-gray-500">180일 내 실거래가 없습니다.</p> : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead><tr className="border-b bg-gray-50 text-left text-xs text-gray-500"><th className="px-3 py-2 font-semibold">거래일</th><th className="px-3 py-2 font-semibold">면적</th><th className="px-3 py-2 font-semibold">층</th><th className="px-3 py-2 text-right font-semibold">금액</th></tr></thead>
              <tbody>
                {trades.slice(0, 15).map((t, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 text-gray-600">{t.dealDate.toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono text-gray-600">{t.excluUseAr.toFixed(1)}㎡</td>
                    <td className="px-3 py-2 text-gray-600">{t.floor ?? '-'}층</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eok(t.dealAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trades.length > 15 && <div className="border-t px-3 py-2 text-xs text-gray-400">외 {trades.length - 15}건</div>}
          </div>
        )}
      </section>

      {/* ── 전세 이력 ── */}
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-bold">전세 계약 이력 <span className="text-sm font-normal text-gray-400">최근 180일 · {jeonse.length}건</span></h2>
        {jeonse.length === 0 ? <p className="rounded-lg border bg-white p-5 text-sm text-gray-500">180일 내 전세 계약이 없습니다.</p> : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead><tr className="border-b bg-gray-50 text-left text-xs text-gray-500"><th className="px-3 py-2 font-semibold">계약일</th><th className="px-3 py-2 font-semibold">면적</th><th className="px-3 py-2 text-right font-semibold">보증금</th><th className="px-3 py-2 font-semibold">구분</th></tr></thead>
              <tbody>
                {jeonse.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 text-gray-600">{r.dealDate.toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono text-gray-600">{r.excluUseAr.toFixed(1)}㎡</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{eok(r.deposit)}</td>
                    <td className="px-3 py-2 text-gray-500">{r.contractType ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {jeonse.length > 10 && <div className="border-t px-3 py-2 text-xs text-gray-400">외 {jeonse.length - 10}건</div>}
          </div>
        )}
      </section>

      {/* ── 정성 팩트(있으면) ── */}
      {facts && (
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-bold">정성 리서치</h2>
          <div className="mt-2 grid gap-1.5 text-[13px] leading-relaxed text-gray-700 sm:grid-cols-2">
            {facts.station && <div>🚇 <RichText text={facts.station} /></div>}
            {facts.catalyst && <div>🚧 <RichText text={facts.catalyst} /></div>}
            {facts.school && <div>🏫 <RichText text={facts.school} /></div>}
            {facts.living && <div>🏢 <RichText text={facts.living} /></div>}
          </div>
          {(facts.cautions?.length ?? 0) > 0 && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">⚠️ {facts.cautions!.join(' · ')}</p>}
          {(facts.sources?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">📎 출처:
              {facts.sources!.map((s, i) => <a key={i} href={srcHref(s)} target="_blank" rel="noreferrer" className="rounded border border-gray-200 px-1.5 py-0.5 text-blue-500 hover:underline">{s.replace(/^https?:\/\//, '').split('/')[0]}</a>)}
            </div>
          )}
        </section>
      )}

      {/* ── 3단 투자분석 + 10년 vs ── */}
      {breakdown && price && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-bold">투자분석 <span className="text-sm font-normal text-gray-400">기준가 {eok(price)}(최저 호가) · 활성 프로필 기준</span></h2>
          <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <InvestBreakdown d={{
              priceManwon: price, jeonseRatioPct: jeonseRatioPct ?? 65, jeonseEstimated: jeonseRatioPct == null,
              tradeCount: trades.length, latestTradeDate: trades[0]?.dealDate.toISOString().slice(0, 10) ?? null, tradeMedian,
              elapsedYear: c.elapsedYear, household: c.household,
              usableToday: breakdown.usableToday, projected2yr: breakdown.projected2yr,
              loan: breakdown.loan, equityIn: breakdown.equityIn, ltvLoan: breakdown.ltvLoan, dsrLoanCap: breakdown.dsrLoanCap, bindingCap: breakdown.bindingCap,
              feasibleToday: breakdown.feasibleToday, feasible2yr: breakdown.feasible2yr,
              monthlyPayment: breakdown.monthlyPayment, interest2yr: breakdown.interest2yr, acqTaxNet: breakdown.acqTaxNet, propertyTax2yr: breakdown.propertyTax2yr, holdingCost: breakdown.holdingCost, remainingLoan: breakdown.remainingLoan,
              base: breakdown.base, conservativeRoe: breakdown.conservative.roeAnnualPct, optimisticRoe: breakdown.optimistic.roeAnnualPct,
              jeonseDeposit: breakdown.jeonseDeposit, loanCleared: breakdown.loanCleared, cashReleased: breakdown.cashReleased, interestReductionPct: breakdown.interestReductionPct, wolseNetMonthly: breakdown.wolseNetMonthly,
              breakevenApprPct: breakdown.breakevenApprPct, altVerdict: breakdown.altVerdict,
              scores: breakdown.scores, totalScore: breakdown.totalScore,
              commuteText: cm ? `${cm.origin.name}(${cm.origin.lines.map(lineLabel).join('·')}) 도보 ${cm.origin.walkMin}분 → ${cm.transfers}회 환승 → 총 ~${cm.totalMin}분 · 자차 ~${cm.driveMin}분` : null,
              workLabel: ctx?.work.label,
            }} />
            {vs && (
              <div className={`mt-4 rounded-lg px-4 py-3 text-[13px] leading-relaxed ${vs.winner === 'APT' ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-100' : 'bg-blue-50 text-blue-900 ring-1 ring-blue-100'}`}>
                <b>🏁 10년 장기 — 집 vs S&P500 ETF({vs.rPct}%): {vs.winner === 'APT' ? '🏠 매수 우위' : '📈 ETF 우위'}</b>
                <div className="mt-1">10년 후 매수 <b>{eok(vs.a10)}</b> vs ETF <b>{eok(vs.b10)}</b> · 손익분기 상승률 <b>{vs.gStar}%/년</b> <Link href="/versus" className="text-xs underline">상세 →</Link></div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── ⑤ 임장 체크리스트 — 현장 확인으로 넘어가는 마지막 단계 ── */}
      <section className="mb-6">
        <details className="rounded-xl border border-gray-200 bg-white open:shadow-sm">
          <summary className="cursor-pointer list-none px-4 py-3 text-lg font-bold">🥾 임장 체크리스트 <span className="text-sm font-normal text-gray-400">— 이 단지를 보러 갈 때(인쇄해서 사용)</span></summary>
          <div className="grid gap-4 border-t border-gray-100 px-4 py-4 text-[13px] leading-relaxed text-gray-700 sm:grid-cols-2">
            <div>
              <b className="text-gray-900">데이터로 확인 못하는 것(현장 필수)</b>
              <ul className="mt-1.5 list-inside list-disc space-y-1">
                <li>동별 일조·소음(도로/철로 면) — 특히 저층 매물</li>
                <li>주차 실태(세대당 대수·이중주차, 평일 저녁 방문)</li>
                <li>관리 상태: 외벽 크랙·누수 흔적·엘리베이터 연식</li>
                <li>관리비 실액(관리사무소에서 최근 고지서 확인)</li>
                <li>언덕·접근 경사(지도 등고선으론 체감 불가)</li>
                <li>커뮤니티·경비 체계, 쓰레기 처리 동선</li>
              </ul>
            </div>
            <div>
              <b className="text-gray-900">중개사에게 물을 것</b>
              <ul className="mt-1.5 list-inside list-disc space-y-1">
                <li>최저 호가 매물({c.minDealPrice ? eok(c.minDealPrice) : '-'})의 사유 — 급매? 하자? 저층?</li>
                <li>실거래 중간({tradeMedian ? eok(tradeMedian) : '-'}) 대비 협상 여지</li>
                <li>전세 놓기 수요(전세가율 {jeonseRatioPct ?? '?'}% 검증) — 공실 기간</li>
                {c.elapsedYear != null && c.elapsedYear >= 25 && <li>재건축/리모델링 추진 현황·주민 동의율{c.far != null ? ` (용적률 ${Math.round(c.far)}%)` : ''}</li>}
                <li>누수·결로 이력, 배관 교체 여부(연식 {c.elapsedYear ?? '?'}년차)</li>
              </ul>
              {risks.length > 0 && (
                <div className="mt-3 rounded-md bg-red-50 px-3 py-2">
                  <b className="text-red-800">이 단지 전용 확인사항(데이터 감지)</b>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-red-800">
                    {risks.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </details>
      </section>

      <CompareBar />
      <footer className="mt-8 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-400">
        🧭 이 프로필은 사전 조사·분석 참고자료입니다 — 최종 판단은 사람이 합니다. 데이터: 국토부 실거래가(매일 06:00) · 네이버 호가(주간 스윕 {c.sweptAt.toISOString().slice(0, 10)}) · 카카오 로컬/모빌리티 · 용적률 new.land — 투자 자문 아님
      </footer>
    </main>
  );
}
