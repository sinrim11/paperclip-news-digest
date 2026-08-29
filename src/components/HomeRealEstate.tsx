/**
 * HomeRealEstate — 홈 최상단 부동산 요약 (2026-08-29 신설).
 *
 * 이 대시보드는 뉴스 앱으로 시작했지만 실사용은 부동산 매수 판단이다. 그런데 홈 첫 화면이
 * 증시 지표와 글로벌 뉴스여서, 매일 쓰는 정보(추천·예산·고시·카드뉴스)가 어디에도 없었다.
 * 그 넷을 한 화면에 모아 '오늘 뭘 보면 되는지'를 즉시 보여준다.
 *
 * 데이터는 파이프라인 산출물을 그대로 읽는다(추가 연산 없음):
 *   config/recommendations.json · region-affordability.json · gosi-hits.json · output/cardnews/index.json
 */

import Link from 'next/link';
import { readFileSync } from 'fs';
import { join } from 'path';

const eok = (m: number) => {
  const v = m / 10000;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '억';
};

function loadJson<T>(rel: string): T | null {
  try { return JSON.parse(readFileSync(join(process.cwd(), rel), 'utf-8')) as T; } catch { return null; }
}

interface Reco { rank: number; name: string; gu: string; dong: string; medianManwon: number; household?: number | null; buildYear?: number | null; reasons: string[]; signalNote?: string }
interface Afford { asOf: string; budgets: { comfortable: number; stretch: number; parentMax: number }; regions: Array<{ gu: string; isSeoul: boolean; counts: { 자기자본권: number; 스트레치: number; 부모님찬스: number; total: number } }> }
interface Gosi { date: string; gu: string; title: string; seq: string; grade?: string; facts?: { areaM2?: number } }
interface CardSet { date: string; series?: string; dir?: string; files: string[]; picks: string[] }

const SERIES_LABEL: Record<string, string> = { price6: '6억 이하', price8: '6~8억', price9: '8~9억', price12: '9~12억', briefing: '호재·정책' };

export function HomeRealEstate() {
  const reco = loadJson<{ asOf: string; items: Reco[] }>('config/recommendations.json');
  const afford = loadJson<Afford>('config/region-affordability.json');
  const gosi = loadJson<Gosi[]>('config/gosi-hits.json');
  const cards = loadJson<CardSet[]>('output/cardnews/index.json');

  const top3 = reco?.items?.slice(0, 3) ?? [];
  const ownCount = afford?.regions.reduce((s, r) => s + r.counts.자기자본권, 0) ?? 0;
  const seoulOwn = afford?.regions.filter((r) => r.isSeoul).reduce((s, r) => s + r.counts.자기자본권, 0) ?? 0;
  const freshGosi = (gosi ?? []).slice(0, 3);
  const latestCard = cards?.[0];

  if (!top3.length && !afford && !freshGosi.length) return null;

  return (
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50/60 to-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold sm:text-lg">🏠 내집마련 현황</h2>
        <span className="text-xs text-gray-400">{reco?.asOf ?? afford?.asOf} 기준 · 매일 자동 갱신</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 오늘의 추천 — 매일 확인하는 1순위 정보 */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5 lg:col-span-2">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">오늘의 추천 {top3.length ? `TOP ${top3.length}` : ''}</h3>
            <Link href="/recommend" className="text-xs font-medium text-blue-600 hover:underline">전체 보기 →</Link>
          </div>
          {top3.length ? (
            <ul className="divide-y divide-gray-100">
              {top3.map((r) => (
                <li key={r.rank} className="flex items-center gap-3 py-2">
                  <span className="w-5 shrink-0 text-center text-sm font-bold text-gray-300 tabular-nums">{r.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{r.name}</div>
                    <div className="truncate text-xs text-gray-500">
                      {r.gu} {r.dong}
                      {r.household ? ` · ${r.household.toLocaleString()}세대` : ''}
                      {r.buildYear ? ` · ${r.buildYear}년` : ''}
                    </div>
                  </div>
                  {r.signalNote && (
                    <span className="hidden shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 sm:inline">
                      {r.signalNote.startsWith('🔻') ? '급매 신호' : '모멘텀'}
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-bold tabular-nums text-blue-700">{eok(r.medianManwon)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-3 text-sm text-gray-400">오늘 조건을 통과한 신규 추천이 없습니다.</p>
          )}
        </div>

        {/* 예산 상태 */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">내 예산으로</h3>
            <Link href="/regions" className="text-xs font-medium text-blue-600 hover:underline">구별 →</Link>
          </div>
          {afford ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold tabular-nums text-emerald-700">{ownCount.toLocaleString()}</span>
                <span className="text-sm text-gray-500">개 단지</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                자기자본권 ≤{eok(afford.budgets.comfortable)} · 서울 {seoulOwn.toLocaleString()}곳
              </p>
              <div className="mt-2.5 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-600">
                <div className="flex justify-between"><span>🟡 스트레치 ≤{eok(afford.budgets.stretch)}</span><span className="tabular-nums">{afford.regions.reduce((s, r) => s + r.counts.스트레치, 0).toLocaleString()}</span></div>
                <div className="flex justify-between"><span>🟣 부모님 찬스 ≤{eok(afford.budgets.parentMax)}</span><span className="tabular-nums">{afford.regions.reduce((s, r) => s + r.counts.부모님찬스, 0).toLocaleString()}</span></div>
              </div>
            </>
          ) : (
            <p className="py-3 text-sm text-gray-400">예산맵 생성 전입니다.</p>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* 고시 선행감지 — 기사보다 먼저 나오는 원문 */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">📜 최근 개발 고시 <span className="font-normal text-gray-400">기사보다 먼저</span></h3>
            <Link href="/gosi" className="text-xs font-medium text-blue-600 hover:underline">이력 →</Link>
          </div>
          {freshGosi.length ? (
            <ul className="space-y-1.5">
              {freshGosi.map((g) => (
                <li key={g.seq} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0">{g.grade === '중간' ? '🟡' : '🔴'}</span>
                  <a href={`https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=${g.seq}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">
                    <span className="font-medium text-gray-900">{g.gu}</span>
                    <span className="text-gray-600"> — {g.title.replace(/^\[[^\]]+\]\s*/, '').slice(0, 42)}…</span>
                    {g.facts?.areaM2 && <span className="ml-1 text-gray-400">{g.facts.areaM2.toLocaleString()}㎡</span>}
                  </a>
                  <span className="shrink-0 text-gray-400 tabular-nums">{g.date.slice(5)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-gray-400">감지된 고시가 없습니다.</p>
          )}
        </div>

        {/* 카드뉴스 */}
        <div className="rounded-xl border border-gray-200 bg-white p-3.5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">📸 최신 카드뉴스</h3>
            <Link href="/cardnews" className="text-xs font-medium text-blue-600 hover:underline">만들기 →</Link>
          </div>
          {latestCard ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/cardnews/${latestCard.dir ?? latestCard.date}/${latestCard.files[0]}`} alt="최신 카드뉴스 표지"
                className="h-20 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
              <div className="min-w-0 text-xs">
                <div className="font-semibold text-gray-900">{SERIES_LABEL[latestCard.series ?? 'price6']} · {latestCard.files.length}장</div>
                <div className="text-gray-500">{latestCard.date}</div>
                <div className="mt-1 truncate text-gray-500">{latestCard.picks.slice(0, 2).join(' · ')}</div>
              </div>
            </div>
          ) : (
            <p className="py-2 text-sm text-gray-400">생성된 카드뉴스가 없습니다.</p>
          )}
        </div>
      </div>
    </section>
  );
}
