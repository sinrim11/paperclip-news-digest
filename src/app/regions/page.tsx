/**
 * /regions — 구별 예산맵 (2026-08-10 개선 구조의 웹 UI).
 *
 * gen-region-affordability.ts가 매일 08:45 생성하는 config/region-affordability.json을 렌더.
 * 3밴드 예산 구조(자기자본권/스트레치/부모님찬스)를 가독성 중심으로:
 *   - 예산 사다리: 0→부모님찬스 상한을 가격축 비례 스펙트럼으로 (밴드 경계 = 실제 예산 경계)
 *   - 구별 스택바: 각 구의 밴드 분포를 비례 막대로 — 어느 구에 선택지가 몰렸는지 한눈에
 *   - <details> 펼침 + 스크롤 테이블(고정 헤더·얼룩 행·tabular-nums) — JS 없이 접근성 확보
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: '구별 예산맵 | 뉴스 다이제스트' };

type Band = '자기자본권' | '스트레치' | '부모님찬스';

interface Entry {
  name: string; dong: string; medianManwon: number; trades: number;
  buildYear: number | null; jeonseRatioPct: number | null; band: Band;
}
interface Region {
  gu: string; isSeoul: boolean; regulation: string;
  counts: Record<Band, number> & { total: number };
  complexes: Entry[];
}
interface Affordability {
  asOf: string;
  budgets: { comfortable: number; stretch: number; parentSupport: number; parentMax: number };
  regions: Region[];
}

const BAND_META: Record<Band, { color: string; bar: string; chip: string; short: string }> = {
  자기자본권: { color: 'text-emerald-700', bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', short: '자기자본' },
  스트레치: { color: 'text-amber-700', bar: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700 ring-amber-200', short: '스트레치' },
  부모님찬스: { color: 'text-violet-700', bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 ring-violet-200', short: '부모님찬스' },
};
const BANDS: Band[] = ['자기자본권', '스트레치', '부모님찬스'];
const BAND_PARAM: Record<string, Band> = { own: '자기자본권', stretch: '스트레치', parent: '부모님찬스' };

const eok = (m: number) => (m / 10000).toFixed(2).replace(/\.?0+$/, '') + '억';

function loadData(): Affordability | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'config', 'region-affordability.json'), 'utf-8')) as Affordability;
  } catch {
    return null;
  }
}

/** 예산 사다리 — 가격축(0→parentMax)에 비례하는 3밴드 스펙트럼. 경계 = 실제 예산 상한. */
function BudgetLadder({ budgets }: { budgets: Affordability['budgets'] }) {
  const { comfortable, stretch, parentMax, parentSupport } = budgets;
  const pct = (v: number) => (v / parentMax) * 100;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full" role="img"
        aria-label={`예산 밴드: 자기자본권 ${eok(comfortable)}까지, 스트레치 ${eok(stretch)}까지, 부모님 찬스 ${eok(parentMax)}까지`}>
        <div className="bg-emerald-500" style={{ width: `${pct(comfortable)}%` }} />
        <div className="bg-amber-400" style={{ width: `${pct(stretch) - pct(comfortable)}%` }} />
        <div className="bg-violet-500" style={{ width: `${100 - pct(stretch)}%` }} />
      </div>
      {/* 데스크톱: 가격축 위치에 맞춘 눈금 라벨 — 모바일에선 7.8/8.8억이 겹쳐 범례로 대체 */}
      <div className="relative mt-1.5 hidden h-9 text-xs leading-tight text-gray-500 sm:block">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 text-center" style={{ left: `${pct(comfortable)}%` }}>
          {eok(comfortable)}<br /><span className="font-medium text-emerald-700">자기자본권</span>
        </span>
        <span className="absolute -translate-x-1/2 text-center" style={{ left: `${pct(stretch)}%` }}>
          {eok(stretch)}<br /><span className="font-medium text-amber-700">스트레치</span>
        </span>
        <span className="absolute right-0 text-right">
          {eok(parentMax)}<br /><span className="font-medium text-violet-700">부모님 찬스 +{eok(parentSupport)}</span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium sm:hidden">
        <span className="text-emerald-700">■ 자기자본권 ≤{eok(comfortable)}</span>
        <span className="text-amber-700">■ 스트레치 ≤{eok(stretch)}</span>
        <span className="text-violet-700">■ 부모님 찬스 ≤{eok(parentMax)}</span>
      </div>
    </div>
  );
}

/** 구별 밴드 분포 스택바 — 폭이 단지 수에 비례. 색만으로 구분하지 않도록 수치 칩 병기. */
function BandBar({ counts, max }: { counts: Region['counts']; max: number }) {
  const width = Math.max(6, (counts.total / max) * 100);
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100" style={{ width: `${width}%`, minWidth: '2.5rem' }} aria-hidden="true">
      {BANDS.map((b) =>
        counts[b] > 0 ? (
          <div key={b} className={BAND_META[b].bar} style={{ width: `${(counts[b] / counts.total) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}

function RegionCard({ region, filter, defaultOpen }: { region: Region; filter: Band | null; defaultOpen: boolean }) {
  const shown = filter ? region.complexes.filter((c) => c.band === filter) : region.complexes;
  const isReg = !region.regulation.includes('비규제');
  return (
    <details open={defaultOpen} className="group rounded-lg border border-gray-200 bg-white open:shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <svg className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform group-open:rotate-90" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="w-24 shrink-0 font-semibold">{region.gu}</span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${isReg ? 'bg-gray-50 text-gray-500 ring-gray-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}
          title={region.regulation}
        >
          {isReg ? '토허·규제' : '비규제'}
        </span>
        <span className="tabular-nums text-sm text-gray-500">{shown.length}개 단지</span>
        <span className="hidden flex-1 sm:block" />
        <span className="hidden items-center gap-1.5 sm:flex" aria-label={BANDS.map((b) => `${b} ${region.counts[b]}개`).join(', ')}>
          {BANDS.map((b) => (
            <span key={b} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${BAND_META[b].chip} ${filter && filter !== b ? 'opacity-30' : ''}`}>
              {region.counts[b]}
            </span>
          ))}
        </span>
      </summary>
      <div className="border-t border-gray-100 px-4 pb-2 pt-3">
        <div className="mb-3 flex items-center gap-2 text-xs text-gray-400">
          <BandBar counts={region.counts} max={region.counts.total} />
          <span>밴드 분포</span>
        </div>
        {shown.length === 0 ? (
          <p className="pb-3 text-sm text-gray-400">이 밴드에 해당하는 단지가 없습니다. 상단 필터를 바꿔 보세요.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded border border-gray-100">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">밴드</th>
                  <th scope="col" className="px-3 py-2 font-medium">단지</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">실거래 중간</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">180일 거래</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">전세가율</th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">준공</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((c, i) => (
                  <tr key={`${c.dong}|${c.name}|${i}`} className="odd:bg-white even:bg-gray-50/60">
                    <td className={`whitespace-nowrap px-3 py-2 text-xs font-medium ${BAND_META[c.band].color}`}>{BAND_META[c.band].short}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1.5 text-xs text-gray-400">{c.dong}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{eok(c.medianManwon)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-600">{c.trades}건</td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-600 sm:table-cell">
                      {c.jeonseRatioPct != null ? `${c.jeonseRatioPct}%` : '—'}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-400 sm:table-cell">{c.buildYear ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

export default async function RegionsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const bandParam = typeof params.band === 'string' ? params.band : undefined;
  const filter: Band | null = bandParam ? (BAND_PARAM[bandParam] ?? null) : null;

  const data = loadData();
  if (!data) {
    return (
      <div className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-8 text-center">
        <h1 className="text-xl font-bold">구별 예산맵</h1>
        <p className="mt-3 text-sm text-gray-500">
          아직 데이터가 없습니다. 매일 08:45 자동 생성되며, 지금 만들려면 아래를 실행하세요.
        </p>
        <code className="mt-4 inline-block rounded bg-gray-100 px-3 py-2 text-xs">npx tsx scripts/gen-region-affordability.ts</code>
      </div>
    );
  }

  const seoul = data.regions.filter((r) => r.isSeoul);
  const gyeonggi = data.regions.filter((r) => !r.isSeoul);
  const totalOf = (rs: Region[]) => rs.reduce((s, r) => s + (filter ? r.complexes.filter((c) => c.band === filter).length : r.counts.total), 0);

  const filterLink = (key: string | null, label: string, band: Band | null) => {
    const active = filter === band;
    return (
      <Link
        key={label}
        href={key ? `/regions?band=${key}` : '/regions'}
        className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors ${
          active || (!filter && !band)
            ? 'bg-gray-900 text-white ring-gray-900'
            : band
              ? `${BAND_META[band].chip} hover:opacity-80`
              : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
        }`}
        aria-current={active || (!filter && !band) ? 'true' : undefined}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold sm:text-2xl">구별 예산맵</h1>
          <span className="text-xs text-gray-400">기준 {data.asOf} · 매일 08:45 갱신 · 최근 180일 실거래 3건+ 단지</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">내 예산으로 갈 수 있는 단지가 어느 구에 얼마나 있는지 — 세 예산 밴드로 봅니다.</p>
      </header>

      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
        <BudgetLadder budgets={data.budgets} />
        <p className="mt-3 text-xs text-gray-400">
          자기자본권·스트레치 상한은 시장 컨텍스트(매일 07:00 리서치)에서, 부모님 찬스는 가족 지원 +{eok(data.budgets.parentSupport)}(2026-08-10 기준) 전제 — 실행 시 증여세·차용증 정리 필요.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {filterLink(null, `전체 ${totalOf(seoul) + totalOf(gyeonggi)}`, null)}
        {filterLink('own', `자기자본권 ≤${eok(data.budgets.comfortable)}`, '자기자본권')}
        {filterLink('stretch', `스트레치 ≤${eok(data.budgets.stretch)}`, '스트레치')}
        {filterLink('parent', `부모님 찬스 ≤${eok(data.budgets.parentMax)}`, '부모님찬스')}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">
          서울 {seoul.length}개 구 · <span className="tabular-nums">{totalOf(seoul)}</span>개 단지
        </h2>
        <div className="space-y-2">
          {seoul.map((r, i) => (
            <RegionCard key={r.gu} region={r} filter={filter} defaultOpen={i === 0} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-500">
          경기 {gyeonggi.length}개 시·구 · <span className="tabular-nums">{totalOf(gyeonggi)}</span>개 단지
        </h2>
        <div className="space-y-2">
          {gyeonggi.map((r) => (
            <RegionCard key={r.gu} region={r} filter={filter} defaultOpen={false} />
          ))}
        </div>
      </section>

      <p className="text-xs text-gray-400">
        데이터: 국토교통부 실거래가 · 전용 50㎡+ · 밴드 = 실거래 중간값 기준. 정보 제공이며 투자 자문이 아닙니다 — 매수 전 현장 확인 필수.
      </p>
    </div>
  );
}
