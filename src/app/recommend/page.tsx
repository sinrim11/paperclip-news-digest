import ProfileBadge from '@/components/ProfileBadge';
import { RecoCompareTable, type CompareRow } from '@/components/RecoCompareTable';
import { bestRoute } from '@/lib/policy-loans';
import DecisionFlow from '@/components/DecisionFlow';
import Link from 'next/link';
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '@/lib/db';
import { loadPolicyParams, loadReaderFinances, computeBudget, formatKRW } from '@/lib/tracker';
import { rankCandidates, GRADE_CUTS, type Recommendation } from '@/lib/recommend';
import { tradeKey } from '@/lib/trade-key';
import { LoanRoutes } from '@/components/LoanRoutes';
import { LAWD_GU } from '@/lib/tiers';

/** daily-recommend가 생성한 스트레치+ 트랙(config/recommendations.json) — 없으면 섹션 미노출 */
interface StretchReco {
  rank: number;
  name: string;
  gu: string;
  dong: string;
  buildYear?: number | null;
  areaText: string;
  medianManwon: number;
  priceRangeText?: string;
  tradeCount?: number;
  overComfortManwon?: number;
  monthlyPayAddManwon?: number;
  monthsToReach?: number | null;
  regulationLabel?: string;
  regulationSources?: string[];
  reasons: string[];
  cautions?: string[];
  complexNo?: string;
}

function loadStretchPlus(): { asOf: string; list: StretchReco[] } | null {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'config', 'recommendations.json'), 'utf-8')) as {
      asOf?: string;
      stretchPlus?: StretchReco[];
    };
    if (!raw.stretchPlus?.length) return null;
    return { asOf: raw.asOf ?? '', list: raw.stretchPlus };
  } catch {
    return null;
  }
}

/** 페르소나별 사전 생성 추천(G3) — gen-persona-recos 산출물. 없으면 섹션 미노출 */
interface PersonaRecoItem {
  complexNo: string; name: string; gu: string; dong: string;
  price: number; area: number | null; elapsedYear: number | null; household: number;
  totalScore: number; metric: string; tradeCount: number; jeonseRatioPct: number;
}
interface PersonaRecoSet { key: string; label: string; desc: string; items: PersonaRecoItem[] }

function loadPersonaRecos(): { asOf: string; personas: PersonaRecoSet[] } | null {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'config', 'persona-recos.json'), 'utf-8')) as {
      asOf?: string; personas?: PersonaRecoSet[];
    };
    if (!raw.personas?.some((p) => p.items.length)) return null;
    return { asOf: raw.asOf ?? '', personas: raw.personas };
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';
export const metadata = { title: '추천 매물 | 뉴스 다이제스트' };

const GRADE_STYLE: Record<Recommendation['grade'], string> = {
  S: 'bg-purple-600 text-white',
  A: 'bg-blue-600 text-white',
  B: 'bg-gray-500 text-white',
  C: 'bg-gray-300 text-gray-700',
};

interface Listing {
  price: number;
  exclusiveArea: number | null;
  floor: string | null;
}

export default async function RecommendPage() {
  const params = loadPolicyParams();
  const fin = loadReaderFinances();
  const scenarios = params && fin ? computeBudget(params, fin) : [];
  const nowBudget = scenarios.length > 1 ? scenarios[1].maxPrice : null;
  const easedBudget = scenarios.length > 2 ? scenarios[2].maxPrice : null;
  const stretch = loadStretchPlus();
  const personaRecos = loadPersonaRecos();

  const [candidates, trades] = await Promise.all([
    prisma.complexCandidate.findMany().catch(() => []),
    prisma.aptTrade
      .findMany({
        where: { dealDate: { gte: new Date(Date.now() - 120 * 86_400_000) } },
        select: { aptName: true, dong: true, lawdCd: true, dealAmount: true },
      })
      .catch(() => []),
  ]);

  // 실거래 중앙값 — 파이프라인의 나머지(추천 엔진·매칭·카드뉴스)와 같은 `구|법정동|정규화이름` 키로 묶는다.
  // 이름만으로 묶으면 '현대'처럼 흔한 단지명이 여러 동의 거래를 한 표본에 섞어(관악 신림동 현대가
  // 208건·중간 9.18억으로 잡혀 갭 -47.7%) 급매도 아닌 매물을 최상위 급매로 보이게 했다.
  // 구까지 넣는 이유: 신사동(강남·은평)·갈현동(은평·과천)처럼 법정동명만으로는 갈리지 않는 곳이 7곳 있다.
  const byName = new Map<string, number[]>();
  for (const t of trades) {
    const key = tradeKey(LAWD_GU[t.lawdCd] ?? t.lawdCd, t.dong, t.aptName);
    const arr = byName.get(key) ?? [];
    arr.push(t.dealAmount);
    byName.set(key, arr);
  }
  const medianByName = new Map<string, number>();
  const countByName = new Map<string, number>(); // 근거 강도 판정용 표본 수
  for (const [name, arr] of byName) {
    arr.sort((a, b) => a - b);
    medianByName.set(name, arr[Math.floor(arr.length / 2)]);
    countByName.set(name, arr.length);
  }

  const ranked = rankCandidates(candidates, medianByName, nowBudget, easedBudget);
  const top = ranked.slice(0, 20);
  const sweptAt = candidates.length ? candidates.reduce((m, c) => (c.sweptAt > m ? c.sweptAt : m), candidates[0].sweptAt) : null;

  // '91점'만으로는 그게 좋은 건지 알 수 없다. 백분위는 상위 20위가 전부 1%로 붙어 변별이 안 되므로
  // 등급 커트라인을 병기한다(S 75↑ / A 60↑ / B 45↑).
  const cutOf = (g: Recommendation['grade']) =>
    g === 'S' ? `S 기준 ${GRADE_CUTS.S}점↑` : g === 'A' ? `A 기준 ${GRADE_CUTS.A}점↑` : g === 'B' ? `B 기준 ${GRADE_CUTS.B}점↑` : `B 미달(${GRADE_CUTS.B}점)`;

  // 근거 등급 — 비교표와 상세 카드가 같은 판정을 쓰도록 한 곳에서 계산
  const evidenceOf = (r: (typeof top)[number]) => {
    const k = tradeKey(r.gu, r.dong, r.name);
    const tm = medianByName.get(k) ?? null;
    const cnt = countByName.get(k) ?? 0;
    const gap = tm && r.minDealPrice ? +(((r.minDealPrice - tm) / tm) * 100).toFixed(1) : null;
    const ev = cnt === 0 || gap == null ? { label: '근거 부족 — 보류', cls: 'bg-red-100 text-red-700' }
      : cnt < 3 ? { label: `표본 ${cnt}건 — 보류`, cls: 'bg-red-100 text-red-700' }
        : gap > 12 ? { label: `갭 +${gap}% — 보류`, cls: 'bg-red-100 text-red-700' }
          : cnt >= 10 && gap <= 2 ? { label: '근거 강', cls: 'bg-emerald-100 text-emerald-700' }
            : { label: '근거 중', cls: 'bg-amber-100 text-amber-800' };
    return { tm, cnt, gap, ev };
  };

  const compareRows: CompareRow[] = top.slice(0, 8).map((r, i) => {
    const { tm, cnt, gap, ev } = evidenceOf(r);
    return {
      complexNo: r.complexNo, rank: i + 1, name: r.name, gu: r.gu, dong: r.dong,
      minPrice: r.minDealPrice ?? null, tradeMedian: tm, gapPct: gap,
      household: r.household, elapsedYear: r.elapsedYear, tradeCount: cnt,
      monthly: r.minDealPrice ? bestRoute(r.minDealPrice)?.monthly ?? null : null,
      cash: r.minDealPrice ? bestRoute(r.minDealPrice)?.cash ?? null : null,
      evidence: ev.label,
    };
  });

  // 상세 카드 렌더 — 상위 8곳은 펼치고 9위 이하는 접어 두려고 함수로 뺀다(2026-08-29)
  const renderCard = (r: (typeof top)[number], i: number) => {
            const cand = candidates.find((c) => c.complexNo === r.complexNo);
            const listings = ((cand?.listings as unknown as Listing[]) ?? []).slice(0, 6);
            const { tm, cnt, gap, ev } = evidenceOf(r); // 비교표와 동일 판정
            return (
              <li key={r.complexNo} id={`reco-${r.complexNo}`} className="scroll-mt-20 rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold tabular-nums text-gray-700">{i + 1}</span>
                  <span className={`rounded px-2 py-0.5 text-sm font-bold ${GRADE_STYLE[r.grade]}`}>{r.grade}</span>
                  <h3 className="text-xl font-bold text-gray-900">{r.name}</h3>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-[13px] font-semibold text-gray-600">
                    {r.score}점 <span className="font-normal text-gray-400">· {cutOf(r.grade)}</span>
                  </span>
                  <span className="ml-auto font-mono text-2xl font-bold tabular-nums text-blue-700">
                    {r.minDealPrice ? formatKRW(r.minDealPrice * 10_000) : '-'}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
                  <span>{r.gu} {r.dong}</span>
                  <span>{r.household.toLocaleString()}세대</span>
                  <span>{r.elapsedYear != null ? `${r.elapsedYear}년차` : '연식미상'}</span>
                  <span>예산 내 {r.inBudgetCount}건</span>
                </div>

                {/* 근거 수치 스트립 — 점수의 원천 데이터를 카드에서 바로 확인 */}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-gray-50 px-3 py-2 text-[13px]">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ev.cls}`}>{ev.label}</span>
                  <span className="text-gray-500">실거래 중간(120일) <b className="font-mono text-gray-900">{tm ? `${formatKRW(tm * 10_000)} (${cnt}건)` : '표본 없음'}</b></span>
                  {gap != null && <span className="text-gray-500">호가 갭 <b className={`font-mono ${gap <= 2 ? 'text-emerald-600' : gap > 10 ? 'text-red-600' : 'text-amber-700'}`}>{gap >= 0 ? '+' : ''}{gap}%</b></span>}
                  <span className="ml-auto flex gap-3">
                    <Link href={`/complex/${r.complexNo}`} className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700">📋 단지 프로필(전체 근거) →</Link>
                    <a href={`https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`} target="_blank" rel="noreferrer" className="self-center text-blue-600 hover:underline">네이버 ↗</a>
                  </span>
                </div>

                {r.minDealPrice ? <LoanRoutes priceManwon={r.minDealPrice} /> : null}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.reasons.map((reason, j) => (
                    <span key={j} className="rounded bg-green-50 px-2.5 py-1 text-[13px] text-green-700">✓ {reason}</span>
                  ))}
                  {r.cautions.map((caution, j) => (
                    <span key={j} className="rounded bg-amber-50 px-2.5 py-1 text-[13px] text-amber-700">⚠ {caution}</span>
                  ))}
                </div>

                {listings.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t pt-2">
                    {listings.map((l, j) => (
                      <span key={j} className="rounded bg-gray-50 px-2.5 py-1.5 text-[13px] tabular-nums text-gray-700">
                        {formatKRW(l.price * 10_000)}
                        {l.exclusiveArea ? ` · ${l.exclusiveArea.toFixed(0)}㎡` : ''}
                        {l.floor ? ` · ${l.floor}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <DecisionFlow current={2} />
      <ProfileBadge mode="ownerOnly" />
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">⭐ 추천 매물 <span className="text-base font-normal text-gray-500">TOP {top.length}</span></h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
          <span>전체 후보 {candidates.length}개 중</span>
          {sweptAt ? (() => {
            // 호가 신선도 — '수집 08-19'만 적어두면 그게 11일 전인지 어제인지 세어봐야 안다.
            const days = Math.floor((Date.now() - sweptAt.getTime()) / 86_400_000);
            return days > 3 ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                ⚠️ 호가 {sweptAt.toISOString().slice(0, 10)} 수집 · {days}일 경과
              </span>
            ) : (
              <span>호가 {sweptAt.toISOString().slice(0, 10)} 수집</span>
            );
          })() : null}
          <Link href="/candidates" className="text-blue-600 hover:underline">전체 후보</Link>
          <Link href="/strategy" className="text-blue-600 hover:underline">전략</Link>
        </div>
        <details className="mt-1 text-xs text-gray-500">
          <summary className="cursor-pointer select-none hover:text-gray-700">자세히</summary>
          <p className="mt-1 leading-relaxed">예산 적합·세대수·투자지역·실거래갭·연식을 종합 점수화한 순위입니다.</p>
        </details>
        <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-[13px] leading-relaxed text-blue-900">
          🧭 점수는 <b>사전 조사·분석의 요약(참고자료)</b>이며 판단을 대신하지 않습니다 — 각 단지의 <b>프로필</b>에서 실거래·전세·통근·계산 근거를 직접 검증하세요.
        </p>
      </header>

      {top.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-gray-500">
          수집된 후보가 아직 없습니다. 스윕 완료 후 표시됩니다.
        </p>
      ) : (
        <>
        {/* 한눈 비교표(2026-08-29) — 세로 나열만으로는 상위끼리 비교가 불가능했다 */}
        <RecoCompareTable rows={compareRows} />
        <ol className="space-y-3">
          {top.slice(0, 8).map((r, i) => renderCard(r, i))}
        </ol>
        {top.length > 8 && (
          <details className="rounded-lg border bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              9~{top.length}위 더 보기 <span className="font-normal text-gray-400">— 조건은 통과했지만 우선순위는 낮음</span>
            </summary>
            <ol className="space-y-3 border-t p-3">
              {top.slice(8).map((r, i) => renderCard(r, i + 8))}
            </ol>
          </details>
        )}
        </>
      )}

      {personaRecos && (
        <section className="rounded-lg border border-purple-200 bg-purple-50/30 p-4">
          <h2 className="text-lg font-bold text-gray-900">
            🎭 페르소나별 추천 <span className="text-sm font-normal text-gray-500">{personaRecos.asOf} · 매일 자동 생성</span>
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
            같은 데이터를 5가지 관점의 <b>결정적 규칙</b>으로 다시 정렬한 사전 추천입니다(LLM 아님). 각 항목의 핵심 수치가
            정렬 근거이며, 판단을 대신하지 않습니다.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {personaRecos.personas.map((p) => (
              <div key={p.key} className="rounded-lg border bg-white p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-bold text-gray-900">{p.label}</h3>
                  <Link href={`/listings?persona=${p.key}`} className="shrink-0 text-xs text-blue-600 hover:underline">전체 →</Link>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-400">{p.desc}</p>
                <ol className="mt-2 space-y-1.5">
                  {p.items.map((it, i) => (
                    <li key={it.complexNo} className="flex items-baseline gap-2 text-[13px]">
                      <span className="font-mono font-bold text-gray-400">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <Link href={`/complex/${it.complexNo}`} className="font-semibold text-gray-900 hover:underline">{it.name}</Link>
                        <span className="text-gray-500"> · {it.gu}</span>
                        <span className="block text-xs text-gray-500">{formatKRW(it.price * 10_000)}{it.area ? ` · ${Math.round(it.area)}㎡` : ''} · <b className="text-purple-700">{it.metric}</b></span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {stretch && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
          <h2 className="text-lg font-bold text-gray-900">
            ➕ 스트레치+ — 조금 더 보태면 사정권 <span className="text-sm font-normal text-gray-500">{stretch.asOf} · {stretch.list.length}건</span>
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-600">
            오늘 자기자본권을 넘지만 스윕 상한 이내인 <b>참고 트랙</b>입니다(일일 추천과 분리). 각 매물에 &quot;+얼마 더&quot;·월 상환
            증가분·조달 개월(월 적립 기준)을 표기합니다. 실행 전 대출 한도(LTV·DSR·정책한도) 재확인이 필수이며, 수치는 참고자료로
            판단을 대신하지 않습니다.
          </p>
          <ol className="mt-3 space-y-3">
            {stretch.list.map((r) => (
              <li key={`${r.gu}|${r.dong}|${r.name}`} className="rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold tabular-nums text-gray-700">{r.rank}</span>
                  <h3 className="text-lg font-bold text-gray-900">{r.name}</h3>
                  <span className="ml-auto font-mono text-xl font-bold tabular-nums text-indigo-700">
                    {formatKRW(r.medianManwon * 10_000)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
                  <span>{r.gu} {r.dong}</span>
                  <span>{r.buildYear ? `${r.buildYear}년` : '연식미상'}</span>
                  <span>{r.areaText}</span>
                  {r.tradeCount ? <span>최근 {r.tradeCount}건 실거래{r.priceRangeText ? ` (${r.priceRangeText})` : ''}</span> : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-gray-50 px-3 py-2 text-[13px]">
                  {r.overComfortManwon != null && (
                    <span className="text-gray-600">더 보태면 <b className="font-mono text-indigo-700">+{formatKRW(r.overComfortManwon * 10_000)}</b></span>
                  )}
                  {r.monthlyPayAddManwon != null && (
                    <span className="text-gray-600">월 상환 증가 <b className="font-mono text-indigo-700">약 +{r.monthlyPayAddManwon}만/월</b></span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    r.monthsToReach == null ? 'bg-gray-200 text-gray-600'
                      : r.monthsToReach <= 24 ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-800'
                  }`}>
                    {r.monthsToReach == null ? '적립액 미설정 — 판정 불가'
                      : r.monthsToReach <= 24 ? `적립 ${r.monthsToReach}개월 뒤 도달 (2년 내)`
                        : `적립 ${r.monthsToReach}개월 — 2년 초과`}
                  </span>
                  {r.complexNo && (
                    <span className="ml-auto flex gap-3">
                      <Link href={`/complex/${r.complexNo}`} className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700">📋 단지 프로필 →</Link>
                      <a href={`https://fin.land.naver.com/complexes/${r.complexNo}?tab=article`} target="_blank" rel="noreferrer" className="self-center text-blue-600 hover:underline">네이버 ↗</a>
                    </span>
                  )}
                </div>
                {r.regulationLabel && (
                  <p className="mt-2 text-[13px] text-gray-600">
                    🧾 규제: {r.regulationLabel}
                    {r.regulationSources?.length ? (
                      <a href={r.regulationSources[0]} target="_blank" rel="noreferrer" className="ml-1.5 text-blue-600 hover:underline">근거 ↗</a>
                    ) : null}
                  </p>
                )}
                <LoanRoutes priceManwon={r.medianManwon} />

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.reasons.map((reason, j) => (
                    <span key={j} className="rounded bg-green-50 px-2.5 py-1 text-[13px] text-green-700">✓ {reason}</span>
                  ))}
                  {(r.cautions ?? []).map((caution, j) => (
                    <span key={j} className="rounded bg-amber-50 px-2.5 py-1 text-[13px] text-amber-700">⚠ {caution}</span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-xs leading-relaxed text-gray-400">
        점수는 개인 예산(트래커)·투자지역 Tier·네이버 호가·국토부 실거래를 결합한 결정적 산식입니다. 투자 판단
        보조 도구이며 금융 자문이 아닙니다. 현장 실사·공고문·실거래를 최종 기준으로 하세요.
      </p>
    </div>
  );
}
