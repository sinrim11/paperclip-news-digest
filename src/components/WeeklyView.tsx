import type { WeeklyDigestContent } from '@/lib/types';
import type { TimelineNewsItem } from './IssueTimeline';
import type { MarketDayData } from './MarketSparklines';
import type { CategorySummaryItem } from './WeeklyCategoryTabs';
import { MarketSparklines } from './MarketSparklines';
import { WeeklyCategoryTabs } from './WeeklyCategoryTabs';

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  '진행중': 'bg-yellow-100 text-yellow-800',
  '해결':   'bg-green-100 text-green-800',
  '확대':   'bg-red-100 text-red-800',
  '소강':   'bg-gray-100 text-gray-600',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLE[status] ?? 'bg-blue-100 text-blue-700';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{status}</span>
  );
}

// ─── Context-evolution badge ──────────────────────────────────────────────────

const EVOLUTION_STYLE: Record<string, string> = {
  '신규': 'bg-blue-100 text-blue-700',
  '지속': 'bg-gray-100 text-gray-600',
  '확대': 'bg-red-100 text-red-700',
  '소강': 'bg-yellow-100 text-yellow-700',
  '해결': 'bg-green-100 text-green-700',
};

function EvolutionBadge({ status }: { status: string }) {
  const key = Object.keys(EVOLUTION_STYLE).find((k) => status.includes(k)) ?? '';
  const cls = EVOLUTION_STYLE[key] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{status}</span>
  );
}

// ─── WeeklyView ───────────────────────────────────────────────────────────────

export function WeeklyView({
  content,
  weekStart,
  weekEnd,
  marketData,
  timelineItems,
}: {
  content: WeeklyDigestContent;
  weekStart: Date;
  weekEnd: Date;
  marketData: MarketDayData[];
  timelineItems: TimelineNewsItem[];
}) {
  const fmt = (d: Date) =>
    d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  // Build category tabs data from full-spec or legacy fields
  const categorySummaries: CategorySummaryItem[] = (() => {
    if (content.category_summaries?.length) {
      return content.category_summaries.map((c) => ({
        category:    c.category,
        summary:     c.summary,
        progression: c.progression,
        highlight:   c.highlight,
      }));
    }
    // Legacy fallback
    return (content.categoryRecaps ?? []).map((r) => ({
      category:    r.category,
      summary:     r.summary,
      progression: '',
      highlight:   r.keyItems?.[0] ?? '',
    }));
  })();

  const weeklyTop5  = content.weekly_top5 ?? [];
  const contextEvol = content.context_evolution ?? [];
  const watchlist   = content.next_week_watchlist;
  const topTrends   = content.topTrends ?? [];

  return (
    <div className="space-y-10">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-1">
          주간 브리핑
        </p>
        <h2 className="text-2xl font-bold">
          {fmt(weekStart)} — {fmt(weekEnd)}
        </h2>
        {content.headline && (
          <p className="mt-2 text-lg text-gray-700 leading-relaxed">{content.headline}</p>
        )}
      </div>

      {/* ── 1. Market sparklines ────────────────────────────────────────── */}
      {marketData.length > 0 && <MarketSparklines data={marketData} />}

      {/* ── 2. Executive Summary ────────────────────────────────────────── */}
      {content.executive_summary && (
        <section className="bg-gradient-to-r from-slate-50 to-blue-50 border border-blue-100 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-3">📋 주간 Executive Summary</h3>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
            {content.executive_summary}
          </p>
          {content.market_weekly?.summary && (
            <p className="mt-3 text-sm text-gray-500 italic border-t border-blue-100 pt-3">
              {content.market_weekly.summary}
            </p>
          )}
        </section>
      )}

      {/* ── 3. Weekly TOP 5 ─────────────────────────────────────────────── */}
      {weeklyTop5.length > 0 && (
        <section>
          <h3 className="font-bold text-lg mb-4">🏆 주간 핵심 TOP 5</h3>
          <div className="space-y-4">
            {weeklyTop5.map((item) => (
              <div
                key={item.rank}
                className="bg-white rounded-xl border border-gray-200 p-5 flex gap-4"
              >
                {/* Rank */}
                <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
                  {item.rank}
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <h4 className="font-semibold text-base leading-snug">{item.title}</h4>
                    <StatusBadge status={item.current_status} />
                  </div>

                  <p className="text-sm text-gray-600 leading-relaxed">{item.fact}</p>

                  {/* Progression timeline */}
                  {item.weekly_progression && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        주간 전개
                      </span>
                      <p className="text-xs text-gray-600 mt-0.5">{item.weekly_progression}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    {item.impact && (
                      <span>
                        <span className="font-medium text-gray-700">💡</span> {item.impact}
                      </span>
                    )}
                    {item.action && (
                      <span>
                        <span className="font-medium text-gray-700">🎯</span> {item.action}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 4. Category tabs ────────────────────────────────────────────── */}
      {categorySummaries.length > 0 && (
        <WeeklyCategoryTabs
          summaries={categorySummaries}
          timelineItems={timelineItems}
        />
      )}

      {/* ── 5. Context evolution map ─────────────────────────────────────── */}
      {contextEvol.length > 0 && (
        <section>
          <h3 className="font-bold text-lg mb-4">🗺️ 이슈 진화 맵</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {contextEvol.map((ev) => (
              <div
                key={ev.tag}
                className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-blue-600 truncate">#{ev.tag}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <EvolutionBadge status={ev.statusChange} />
                    <span className="text-xs text-gray-400 tabular-nums">{ev.weeklyCount}회</span>
                  </div>
                </div>
                {ev.nextWeekOutlook && (
                  <p className="text-xs text-gray-500 leading-relaxed">{ev.nextWeekOutlook}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Legacy: top trends (fallback) ────────────────────────────────── */}
      {!contextEvol.length && topTrends.length > 0 && (
        <section>
          <h3 className="font-bold text-lg mb-4">이번 주 반복된 트렌드</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topTrends.map((trend) => (
              <div
                key={trend.tag}
                className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-600">#{trend.tag}</span>
                  <span className="text-xs text-gray-400 tabular-nums">{trend.count}회 언급</span>
                </div>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full"
                    style={{
                      width: `${Math.min(100, (trend.count / (topTrends[0]?.count ?? 1)) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{trend.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 6. Next-week watchlist ───────────────────────────────────────── */}
      {watchlist && (
        <section className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 space-y-4">
          <h3 className="font-bold text-lg">📅 다음 주 관전 포인트</h3>

          {watchlist.scheduled_events?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">예정 이벤트</h4>
              <div className="space-y-2">
                {watchlist.scheduled_events.map((ev, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <span className="shrink-0 font-semibold text-blue-700 w-12">{ev.date}</span>
                    <span className="flex-1 text-gray-700">{ev.event}</span>
                    {ev.impact && (
                      <span className="shrink-0 text-xs text-gray-500 italic">{ev.impact}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {watchlist.investment_checklist?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">투자 체크리스트</h4>
              <ul className="space-y-1.5">
                {watchlist.investment_checklist.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-0.5 shrink-0 w-4 h-4 border border-gray-400 rounded" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {watchlist.ongoing_monitors?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">지속 모니터링</h4>
              <ul className="space-y-1">
                {watchlist.ongoing_monitors.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-500">
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Legacy: outlook fallback ──────────────────────────────────────── */}
      {!watchlist && content.outlook && (
        <section className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-2">📅 다음 주 전망</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{content.outlook}</p>
        </section>
      )}
    </div>
  );
}
