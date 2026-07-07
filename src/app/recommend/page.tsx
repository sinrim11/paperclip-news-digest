import ProfileBadge from '@/components/ProfileBadge';
import DecisionFlow from '@/components/DecisionFlow';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { loadPolicyParams, loadReaderFinances, computeBudget, formatKRW } from '@/lib/tracker';
import { rankCandidates, type Recommendation } from '@/lib/recommend';

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

  const [candidates, trades] = await Promise.all([
    prisma.complexCandidate.findMany().catch(() => []),
    prisma.aptTrade
      .findMany({
        where: { dealDate: { gte: new Date(Date.now() - 120 * 86_400_000) } },
        select: { aptName: true, dealAmount: true },
      })
      .catch(() => []),
  ]);

  // 이름별 실거래 중앙값
  const byName = new Map<string, number[]>();
  for (const t of trades) {
    const arr = byName.get(t.aptName) ?? [];
    arr.push(t.dealAmount);
    byName.set(t.aptName, arr);
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

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <DecisionFlow current={2} />
      <ProfileBadge mode="ownerOnly" />
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">⭐ 추천 매물 <span className="text-base font-normal text-gray-500">TOP {top.length}</span></h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
          <span>전체 후보 {candidates.length}개 중</span>
          {sweptAt ? <span>수집 {sweptAt.toISOString().slice(0, 10)}</span> : null}
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
        <ol className="space-y-3">
          {top.map((r, i) => {
            const cand = candidates.find((c) => c.complexNo === r.complexNo);
            const listings = ((cand?.listings as unknown as Listing[]) ?? []).slice(0, 6);
            const tm = medianByName.get(r.name) ?? null; // 실거래 중간(120일) — 근거 수치 노출
            const cnt = countByName.get(r.name) ?? 0;
            const gap = tm && r.minDealPrice ? +(((r.minDealPrice - tm) / tm) * 100).toFixed(1) : null;
            // 설득 게이트: 시세 근거가 약하면 점수와 무관하게 '보류' 명시
            const ev = cnt === 0 || gap == null ? { label: '근거 부족 — 보류', cls: 'bg-red-100 text-red-700' }
              : cnt < 3 ? { label: `표본 ${cnt}건 — 보류`, cls: 'bg-red-100 text-red-700' }
                : gap > 12 ? { label: `갭 +${gap}% — 보류`, cls: 'bg-red-100 text-red-700' }
                  : cnt >= 10 && gap <= 2 ? { label: '근거 강', cls: 'bg-emerald-100 text-emerald-700' }
                    : { label: '근거 중', cls: 'bg-amber-100 text-amber-800' };
            return (
              <li key={r.complexNo} className="rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold tabular-nums text-gray-700">{i + 1}</span>
                  <span className={`rounded px-2 py-0.5 text-sm font-bold ${GRADE_STYLE[r.grade]}`}>{r.grade}</span>
                  <h3 className="text-xl font-bold text-gray-900">{r.name}</h3>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-[13px] font-semibold text-gray-600">{r.score}점</span>
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
          })}
        </ol>
      )}

      <p className="text-xs leading-relaxed text-gray-400">
        점수는 개인 예산(트래커)·투자지역 Tier·네이버 호가·국토부 실거래를 결합한 결정적 산식입니다. 투자 판단
        보조 도구이며 금융 자문이 아닙니다. 현장 실사·공고문·실거래를 최종 기준으로 하세요.
      </p>
    </div>
  );
}
