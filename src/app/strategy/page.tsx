import Link from 'next/link';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadPolicyParams, loadReaderFinances, computeBudget, formatKRW } from '@/lib/tracker';

export const dynamic = 'force-dynamic';

export const metadata = { title: '투자 전략 | 뉴스 다이제스트' };

interface RadarItem {
  name: string;
  area: string;
  type: string;
  schedule: string;
  price: string;
  priceMin?: number;
  equityNeeded?: number;
  verdict: 'apply-always' | 'apply' | 'study' | 'watch' | 'skip';
  note: string;
}
interface Tier { rank: number; area: string; thesis: string; targets: string[]; risk: string }
interface Shopping { name: string; price: number; action: string }
interface Strategy {
  updatedAt: string;
  conclusion: string[];
  subscriptionRadar: RadarItem[];
  tiers: Tier[];
  shoppingList: Shopping[];
}

function loadStrategy(): Strategy | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'config', 'investment-strategy.json'), 'utf-8')) as Strategy;
  } catch {
    return null;
  }
}

const VERDICT_BADGE: Record<RadarItem['verdict'], { label: string; cls: string }> = {
  'apply-always': { label: '상시 신청', cls: 'bg-green-100 text-green-700' },
  apply: { label: '신청', cls: 'bg-green-100 text-green-700' },
  study: { label: '검토', cls: 'bg-blue-100 text-blue-700' },
  watch: { label: '관찰(온도계)', cls: 'bg-amber-100 text-amber-700' },
  skip: { label: '제외', cls: 'bg-gray-100 text-gray-500' },
};

export default function StrategyPage() {
  const strategy = loadStrategy();
  const params = loadPolicyParams();
  const fin = loadReaderFinances();
  const scenarios = params && fin ? computeBudget(params, fin) : [];
  const nowBudget = scenarios.length > 1 ? scenarios[1].maxPrice : null; // 생초 우대
  const easedBudget = scenarios.length > 2 ? scenarios[2].maxPrice : null; // 완화 가정

  if (!strategy) {
    return <p className="p-8 text-sm text-gray-500">config/investment-strategy.json이 없습니다.</p>;
  }

  const fitBadge = (item: RadarItem) => {
    if (item.equityNeeded && fin) {
      return fin.usableCapital >= item.equityNeeded
        ? { label: '자기자금 충족', cls: 'bg-green-50 text-green-700 border border-green-200' }
        : { label: '자기자금 부족', cls: 'bg-red-50 text-red-600 border border-red-200' };
    }
    if (!item.priceMin || !nowBudget || !easedBudget) return null;
    if (item.priceMin <= nowBudget) return { label: '지금 예산 내', cls: 'bg-green-50 text-green-700 border border-green-200' };
    if (item.priceMin <= easedBudget) return { label: '완화 시 사정권', cls: 'bg-blue-50 text-blue-700 border border-blue-200' };
    return { label: '예산 밖', cls: 'bg-gray-50 text-gray-500 border border-gray-200' };
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">🎯 투자 전략 — 지금 무엇을 볼 것인가</h1>
        <p className="mt-1 text-sm text-gray-500">
          갱신 {strategy.updatedAt} · 예산 기준: 현행 {nowBudget ? formatKRW(nowBudget) : '—'} / 완화 시{' '}
          {easedBudget ? formatKRW(easedBudget) : '—'} (<Link href="/tracker" className="text-blue-600 hover:underline">계산 근거 → 트래커</Link>)
        </p>
      </header>

      {/* 결론 */}
      <section className="rounded-lg border-2 border-blue-200 bg-blue-50 p-5">
        <h2 className="font-bold text-blue-900">한눈 결론</h2>
        <ol className="mt-2 list-inside list-decimal space-y-1.5 text-sm leading-relaxed text-blue-900">
          {strategy.conclusion.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ol>
      </section>

      {/* 청약 레이더 */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">📡 청약 레이더</h2>
        <div className="mt-3 space-y-3">
          {strategy.subscriptionRadar.map((item) => {
            const v = VERDICT_BADGE[item.verdict];
            const fit = fitBadge(item);
            return (
              <div key={item.name} className="rounded-md border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${v.cls}`}>{v.label}</span>
                  {fit && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${fit.cls}`}>{fit.label}</span>}
                  <h3 className="font-semibold text-gray-900">{item.name}</h3>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {item.area} · {item.type} · {item.schedule} · <b className="text-gray-700">{item.price}</b>
                </p>
                <p className="mt-1.5 text-sm text-gray-700">{item.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 지역 Tier */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">🗺️ 타깃 지역 우선순위</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {strategy.tiers.map((t) => (
            <div key={t.rank} className="rounded-md border p-4">
              <h3 className="font-bold text-gray-900">
                <span className="mr-1.5 rounded bg-gray-900 px-1.5 py-0.5 text-xs font-bold text-white">T{t.rank}</span>
                {t.area}
              </h3>
              <p className="mt-1.5 text-sm text-gray-700">{t.thesis}</p>
              <ul className="mt-2 list-inside list-disc text-xs text-gray-600">
                {t.targets.map((tg) => (
                  <li key={tg}>{tg}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-red-500">⚠ {t.risk}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 완화 시 쇼핑리스트 */}
      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold text-gray-900">🛒 규제 완화 트리거 발동 시 쇼핑리스트</h2>
        <p className="mt-1 text-xs text-gray-500">
          완화 발표 후엔 늦는다 — 미리 정해두고 시세만 추적하다 트리거가 뜨면 실사·계약으로 직행 (트리거 감시는{' '}
          <Link href="/tracker" className="text-blue-600 hover:underline">트래커</Link>가 수행)
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-3">대상</th>
                <th className="py-2 pr-3">기준가(실거래·추정)</th>
                <th className="py-2">액션</th>
              </tr>
            </thead>
            <tbody>
              {strategy.shoppingList.map((s) => (
                <tr key={s.name} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium text-gray-900">{s.name}</td>
                  <td className="py-2 pr-3">{formatKRW(s.price)}</td>
                  <td className="py-2 text-gray-700">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-gray-400">
        분양가·시세는 조사 시점 기준이며 공고문·실거래가 우선한다. 본 페이지는 투자 판단 보조 도구이지 금융 자문이
        아니다. 정책 근거: <Link href="/guide/policy" className="text-blue-600 hover:underline">정책 가이드</Link>
      </p>
    </div>
  );
}
