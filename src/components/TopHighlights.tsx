// vercel-react-best-practices §rerender: RSC — no interactivity, pure Tailwind
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

// gradient needs both from-* and to-* for the transition to be visible
const RANK_STYLES = [
  { card: 'from-yellow-50 to-white border-yellow-300', ring: 'ring-2 ring-yellow-400 bg-yellow-500' },
  { card: 'from-gray-50 to-white border-gray-300',     ring: 'ring-2 ring-gray-300   bg-gray-600' },
  { card: 'from-orange-50 to-white border-orange-200', ring: 'ring-2 ring-amber-400  bg-amber-600' },
];

export function TopHighlights({ items }: { items: Top3Item[] }) {
  if (!items.length) return null;

  return (
    <section>
      <h3 className="font-bold text-lg mb-4">🏆 오늘의 TOP 3</h3>
      <div className="space-y-4">
        {items.map((item, idx) => {
          const style = RANK_STYLES[idx] ?? RANK_STYLES[2];
          return (
            <article
              key={item.id}
              className={`rounded-xl border bg-gradient-to-r ${style.card} p-5 shadow-sm hover:shadow-md transition-all duration-200 ease-out`}
            >
              <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                <span className={`text-xs font-black text-white w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${style.ring}`}>
                  {item.top3Rank}
                </span>
                <span className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                  {CATEGORY_LABEL[item.category] ?? item.category}
                </span>
                <UrgencyBadge urgency={item.urgency} />
              </div>

              <h4 className="font-semibold mb-3 leading-snug text-gray-900">
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-blue-700 hover:underline underline-offset-2 decoration-blue-300 transition-colors duration-150"
                  >
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </h4>

              <div className="space-y-1.5 text-sm leading-relaxed text-gray-700">
                <p><span className="font-semibold text-gray-800">📌 팩트:</span> {item.fact}</p>
                <p><span className="font-semibold text-gray-800">💡 임팩트:</span> {item.impact}</p>
                <p><span className="font-semibold text-gray-800">🎯 액션:</span> {item.action}</p>
              </div>

              {item.relatedData.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.relatedData.map((d) => (
                    <span key={d} className="text-xs bg-white/80 border border-gray-200 px-2 py-0.5 rounded-full text-gray-600 shadow-sm">
                      {d}
                    </span>
                  ))}
                </div>
              )}

              {item.upcomingEvents.length > 0 && (
                <div className="mt-2.5 text-xs text-gray-500 flex items-start gap-1">
                  <span>📅</span>
                  <span>{item.upcomingEvents.join(' · ')}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
