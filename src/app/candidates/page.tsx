import ProfileBadge from '@/components/ProfileBadge';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { loadPolicyParams, loadReaderFinances, computeBudget, formatKRW } from '@/lib/tracker';

export const dynamic = 'force-dynamic';
export const metadata = { title: '매물 후보 | 뉴스 다이제스트' };

interface Listing {
  price: number;
  exclusiveArea: number | null;
  floor: string | null;
  dong: string | null;
  name: string | null;
}

/** 금액대 밴드(G2-2) — 최저 호가(만원) 기준 [min, max) */
const PRICE_BANDS: Array<{ key: string; label: string; min: number; max: number | null }> = [
  { key: 'b5', label: '~5억', min: 0, max: 50000 },
  { key: 'b56', label: '5~6억', min: 50000, max: 60000 },
  { key: 'b67', label: '6~7억', min: 60000, max: 70000 },
  { key: 'b78', label: '7~8억', min: 70000, max: 80000 },
  { key: 'b8p', label: '8억+', min: 80000, max: null },
];
const inBand = (min: number | null, b: { min: number; max: number | null }) =>
  min != null && min >= b.min && (b.max == null || min < b.max);

/** 경기 지역 판별 — 필터 UI 서울/경기 그룹화(G2-1) */
const isGyeonggi = (gu: string) => gu.endsWith('시') || gu.includes(' ');

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams?: Promise<{ gu?: string; sort?: string; band?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const guFilter = sp.gu;
  const sort = sp.sort ?? 'price';

  const params = loadPolicyParams();
  const fin = loadReaderFinances();
  const scenarios = params && fin ? computeBudget(params, fin) : [];
  const nowBudget = scenarios.length > 1 ? scenarios[1].maxPrice : null;
  const easedBudget = scenarios.length > 2 ? scenarios[2].maxPrice : null;

  // 전체를 항상 로드 — 구 칩·밴드 카운트가 필터와 무관하게 전 지역을 보여야 함(G2-1 버그 수정)
  const all = await prisma.complexCandidate.findMany().catch(() => []);

  const band = PRICE_BANDS.find((b) => b.key === sp.band);
  let filtered = guFilter ? all.filter((c) => c.gu === guFilter) : all;
  if (band) filtered = filtered.filter((c) => inBand(c.minDealPrice, band));

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'household') return b.household - a.household;
    if (sort === 'year') return (a.elapsedYear ?? 999) - (b.elapsedYear ?? 999);
    return (a.minDealPrice ?? 9e9) - (b.minDealPrice ?? 9e9);
  });

  const gus = [...new Set(all.map((c) => c.gu))].sort();
  const sweptAt = all.length ? all.reduce((max, c) => (c.sweptAt > max ? c.sweptAt : max), all[0].sweptAt) : null;
  const ceiling = all.length ? all[0].budgetCeiling : null;
  // 밴드별 카운트(현재 구 필터 반영) — 금액대 분포 한눈에
  const bandBase = guFilter ? all.filter((c) => c.gu === guFilter) : all;
  const qs = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    const merged = { gu: guFilter ?? '', sort: sp.sort ?? '', band: sp.band ?? '', ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/candidates?${s}` : '/candidates';
  };

  const fitClass = (min: number | null): string => {
    if (min === null || !nowBudget || !easedBudget) return 'bg-gray-50 text-gray-500';
    if (min * 10_000 <= nowBudget) return 'bg-green-100 text-green-800';
    if (min * 10_000 <= easedBudget) return 'bg-blue-100 text-blue-800';
    return 'bg-amber-50 text-amber-700';
  };
  const fitLabel = (min: number | null): string => {
    if (min === null || !nowBudget || !easedBudget) return '?';
    if (min * 10_000 <= nowBudget) return '지금 가능';
    if (min * 10_000 <= easedBudget) return '완화 시';
    return '자본성장 필요';
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <ProfileBadge mode="ownerOnly" />
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">🏘️ 매물 후보 <span className="text-base font-normal text-gray-500">전수 발굴</span></h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {ceiling ? <span>예산 상한 <b className="font-mono font-semibold tabular-nums text-gray-700">{formatKRW(ceiling * 10_000)}</b></span> : null}
          {sweptAt ? <span>수집 {sweptAt.toISOString().slice(0, 10)}</span> : null}
          <Link href="/strategy" className="text-blue-600 hover:underline">전략 →</Link>
        </div>
        <details className="mt-1 text-xs text-gray-500">
          <summary className="cursor-pointer select-none hover:text-gray-700">자세히</summary>
          <p className="mt-1 leading-relaxed">150세대 이상 · 전용 50㎡+ · 서울 25구 + 경기(남양주·안양 만안/동안·의왕) · 주 4회 분할 수집(일·목=서울 서남/동북, 수·토=서울 나머지+경기 — 지역당 3~4일 간격) · 예산 내 매매 매물 보유 단지만 표시합니다.</p>
        </details>
      </header>

      {/* 필터 — 지역(서울/경기 그룹, G2-1) · 금액대(G2-2) · 정렬 */}
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">서울:</span>
          <Link href={qs({ gu: '' })} className={`rounded px-2 py-1 ${!guFilter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>전체 ({all.length})</Link>
          {gus.filter((g) => !isGyeonggi(g)).map((g) => (
            <Link key={g} href={qs({ gu: g })} className={`rounded px-2 py-1 ${guFilter === g ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {g} ({all.filter((c) => c.gu === g).length})
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">경기:</span>
          {gus.filter(isGyeonggi).length === 0
            ? <span className="text-xs text-gray-400">수집 대기(다음 스윕 후 표시)</span>
            : gus.filter(isGyeonggi).map((g) => (
              <Link key={g} href={qs({ gu: g })} className={`rounded px-2 py-1 ${guFilter === g ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
                {g} ({all.filter((c) => c.gu === g).length})
              </Link>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">금액대:</span>
          {PRICE_BANDS.map((b) => (
            <Link key={b.key} href={qs({ band: sp.band === b.key ? '' : b.key })} className={`rounded px-2 py-1 tabular-nums ${sp.band === b.key ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {b.label} ({bandBase.filter((c) => inBand(c.minDealPrice, b)).length})
            </Link>
          ))}
          <span className="ml-3 text-gray-500">정렬:</span>
          {[['price', '최저가'], ['household', '세대수'], ['year', '신축순']].map(([k, label]) => (
            <Link key={k} href={qs({ sort: k })} className={`rounded px-2 py-1 ${sort === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{label}</Link>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-gray-500">
          아직 수집된 후보가 없습니다. <code>scripts/naver-sweep.sh</code> 실행 후 표시됩니다.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((c) => {
            const listings = (c.listings as unknown as Listing[]) ?? [];
            return (
              <div key={c.id} className="rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${fitClass(c.minDealPrice)}`}>{fitLabel(c.minDealPrice)}</span>
                  <h3 className="text-lg font-bold text-gray-900">{c.name}</h3>
                  <span className="ml-auto text-right">
                    <span className="font-mono text-lg font-bold tabular-nums text-blue-700">{c.minDealPrice ? formatKRW(c.minDealPrice * 10_000) : '-'}</span>
                    <span className="font-mono text-xs tabular-nums text-gray-500"> ~ {c.maxDealPrice ? formatKRW(c.maxDealPrice * 10_000) : '-'}</span>
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span>{c.gu} {c.dong}</span>
                  <span>{c.household.toLocaleString()}세대</span>
                  <span>{c.elapsedYear != null ? `준공 ${c.elapsedYear}년차` : '연식 미상'}</span>
                  <span>전체 매물 {c.totalArticles}건 중 매매 {c.dealArticles}건</span>
                  <b className="font-semibold text-green-700">예산 내 {c.inBudgetCount}건</b>
                  <Link href={`/complex/${c.complexNo}`} className="rounded-full bg-gray-900 px-2.5 py-0.5 font-semibold text-white hover:bg-gray-700">📋 단지 프로필 →</Link>
                  <a
                    href={`https://fin.land.naver.com/complexes/${c.complexNo}?tab=article`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    네이버 ↗
                  </a>
                </div>
                {listings.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {listings.slice(0, 8).map((l, i) => (
                      <span key={i} className="rounded bg-gray-50 px-2 py-1 text-xs tabular-nums text-gray-700">
                        {formatKRW(l.price * 10_000)}
                        {l.exclusiveArea ? ` · ${l.exclusiveArea.toFixed(0)}㎡` : ''}
                        {l.floor ? ` · ${l.floor}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-gray-400">
        네이버 호가 스냅샷(수집 시점) 기준. 실거래·현장 확인이 우선이며 금융 자문이 아닙니다. 가격 배지는 개인
        예산(트래커) 대비 자동 판정.
      </p>
    </div>
  );
}
