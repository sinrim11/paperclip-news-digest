import { CATEGORY_LABEL, type CategoryKey, type Urgency } from '@/lib/types';
import { UrgencyBadge } from './UrgencyBadge';

export interface Top3Item {
  id: string;
  title: string;
  category: CategoryKey;
  urgency: Urgency;
  top3Rank: number;
  fact: string;
  impact: string;
  action: string;
  relatedData: string[];
  contextLinks: string[];
  upcomingEvents: string[];
  sourceUrl: string;
}

const RANK_COLORS = ['from-yellow-50 border-yellow-300', 'from-gray-50 border-gray-300', 'from-orange-50 border-orange-200'];

export function TopHighlights({ items }: { items: Top3Item[] }) {
  if (!items.length) return null;

  return (
    <section>
      <h3 className="font-bold text-lg mb-4">🏆 오늘의 TOP 3</h3>
      <div className="space-y-4">
        {items.map((item, idx) => (
          <article
            key={item.id}
            className={`rounded-xl border bg-gradient-to-r ${RANK_COLORS[idx] ?? RANK_COLORS[2]} p-5`}
          >
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-sm font-black bg-gray-900 text-white w-7 h-7 rounded-full flex items-center justify-center shrink-0">
                {item.top3Rank}
              </span>
              <span className="text-xs text-gray-500 font-medium">
                {CATEGORY_LABEL[item.category] ?? item.category}
              </span>
              <UrgencyBadge urgency={item.urgency} />
            </div>

            <h4 className="font-semibold mb-3 leading-snug">
              {item.sourceUrl ? (
                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </h4>

            <div className="space-y-1 text-sm">
              <p><span className="font-semibold">📌 팩트:</span> {item.fact}</p>
              <p><span className="font-semibold">💡 임팩트:</span> {item.impact}</p>
              <p><span className="font-semibold">🎯 액션:</span> {item.action}</p>
            </div>

            {item.relatedData.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.relatedData.map((d) => (
                  <span key={d} className="text-xs bg-white/70 border border-gray-200 px-2 py-0.5 rounded-full">
                    {d}
                  </span>
                ))}
              </div>
            )}

            {item.upcomingEvents.length > 0 && (
              <div className="mt-2 text-xs text-gray-500">
                📅 {item.upcomingEvents.join(' · ')}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
