import type { WeeklyDigestContent } from '@/lib/types';
import { CATEGORY_LABEL, type CategoryKey } from '@/lib/types';

const CATEGORY_ICON: Record<string, string> = {
  GLOBAL: '🌐',
  STOCKS: '📈',
  AI: '🤖',
  POLICY: '🏛️',
  REALESTATE: '🏠',
};

function labelToKey(label: string): CategoryKey | null {
  const map: Record<string, CategoryKey> = {
    '글로벌': 'GLOBAL',
    '증권': 'STOCKS',
    'AI': 'AI',
    '정부정책': 'POLICY',
    '부동산': 'REALESTATE',
  };
  return map[label] ?? null;
}

export function WeeklyView({ content, weekStart, weekEnd }: {
  content: WeeklyDigestContent;
  weekStart: Date;
  weekEnd: Date;
}) {
  const fmt = (d: Date) =>
    d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  // Resolve optional legacy fields to stable arrays for type-safe rendering
  const categoryRecaps = content.categoryRecaps ?? [];
  const topTrends = content.topTrends ?? [];

  return (
    <div className="space-y-8">
      {/* Week header */}
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
        {content.executive_summary && (
          <p className="mt-2 text-base text-gray-600 leading-relaxed">{content.executive_summary}</p>
        )}
      </div>

      {/* Category recaps */}
      {categoryRecaps.length > 0 && (
        <section>
          <h3 className="font-bold text-lg mb-4">카테고리별 주간 총평</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {categoryRecaps.map((recap) => {
              const key = labelToKey(recap.category);
              const icon = key ? CATEGORY_ICON[key] : '📋';
              const label = key ? CATEGORY_LABEL[key] : recap.category;
              return (
                <div
                  key={recap.category}
                  className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{icon}</span>
                    <h4 className="font-semibold">{label}</h4>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{recap.summary}</p>
                  {recap.keyItems?.length > 0 && (
                    <ul className="space-y-1">
                      {recap.keyItems.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-500">
                          <span className="mt-1 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Top trends */}
      {topTrends.length > 0 && (
        <section>
          <h3 className="font-bold text-lg mb-4">이번 주 반복된 트렌드</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topTrends.map((trend, i) => (
              <div
                key={trend.tag}
                className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-600">#{trend.tag}</span>
                  <span className="text-xs text-gray-400 tabular-nums">{trend.count}회 언급</span>
                </div>
                {/* Frequency bar */}
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full transition-all"
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

      {/* Outlook */}
      {content.outlook && (
        <section className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-bold text-lg mb-2">📅 다음 주 전망</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{content.outlook}</p>
        </section>
      )}
    </div>
  );
}
