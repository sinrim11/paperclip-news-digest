import type { CategoryKey, Urgency } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/types';
import { UrgencyBadge } from './UrgencyBadge';

export interface TimelineNewsItem {
  id: string;
  title: string;
  category: CategoryKey;
  urgency: Urgency;
  fact: string;
  contextTags: string[];
  sourceUrl?: string;
  digestDate: string; // YYYY-MM-DD
}

interface DayGroup {
  date: string;
  label: string;
  items: TimelineNewsItem[];
  breakingCount: number;
}

const CATEGORY_ICON: Record<CategoryKey, string> = {
  GLOBAL: '🌐',
  STOCKS: '📈',
  AI: '🤖',
  POLICY: '🏛️',
  REALESTATE: '🏠',
};

const URGENCY_LINE: Record<Urgency, string> = {
  breaking: 'border-red-400 bg-red-50',
  watch: 'border-yellow-300 bg-yellow-50',
  note: 'border-gray-200 bg-white',
};

const DOT_COLOR: Record<Urgency, string> = {
  breaking: 'bg-red-500 ring-red-200',
  watch: 'bg-yellow-400 ring-yellow-100',
  note: 'bg-gray-300 ring-gray-100',
};

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

export function IssueTimeline({ items }: { items: TimelineNewsItem[] }) {
  if (!items.length) return null;

  // Group by date, newest first
  const dateMap = new Map<string, TimelineNewsItem[]>();
  for (const item of items) {
    if (!dateMap.has(item.digestDate)) dateMap.set(item.digestDate, []);
    dateMap.get(item.digestDate)!.push(item);
  }

  const days: DayGroup[] = [...dateMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, dayItems]) => ({
      date,
      label: formatDayLabel(date),
      // Sort: breaking first, then by category
      items: dayItems.sort((a, b) => {
        const urgencyOrder = { breaking: 0, watch: 1, note: 2 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      }),
      breakingCount: dayItems.filter((i) => i.urgency === 'breaking').length,
    }));

  return (
    <section>
      <h3 className="font-bold text-lg mb-6">📊 이슈 타임라인</h3>

      <div className="relative">
        {/* Vertical spine */}
        <div className="absolute left-16 top-0 bottom-0 w-px bg-gray-200" />

        <div className="space-y-8">
          {days.map((day) => (
            <div key={day.date} className="relative flex gap-6">
              {/* Day label */}
              <div className="w-16 shrink-0 text-right pt-1">
                <span className="text-xs font-semibold text-gray-500 leading-tight block">
                  {day.label.split(' ').slice(0, -1).join(' ')}
                </span>
                <span className="text-xs text-gray-400 block">
                  {day.label.split(' ').pop()}
                </span>
                {day.breakingCount > 0 && (
                  <span className="mt-1 inline-block text-xs bg-red-100 text-red-600 px-1 rounded font-bold">
                    {day.breakingCount}🔴
                  </span>
                )}
              </div>

              {/* Day node dot */}
              <div className="relative shrink-0">
                <div className="w-3 h-3 rounded-full bg-gray-400 ring-4 ring-gray-100 mt-1 relative z-10" />
              </div>

              {/* Items */}
              <div className="flex-1 space-y-2 pb-2">
                {day.items.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg border-l-2 ${URGENCY_LINE[item.urgency]} border border-l-2 px-3 py-2.5`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1 w-2 h-2 rounded-full shrink-0 ring-2 ${DOT_COLOR[item.urgency]}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                          <span className="text-xs text-gray-400">
                            {CATEGORY_ICON[item.category]}{' '}
                            {CATEGORY_LABEL[item.category] ?? item.category}
                          </span>
                          <UrgencyBadge urgency={item.urgency} />
                        </div>
                        <p className="text-sm font-medium leading-snug">
                          {item.sourceUrl ? (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline hover:text-blue-600"
                            >
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.fact}</p>
                        {item.contextTags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.contextTags.slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                className="text-xs bg-gray-100 text-gray-500 px-1.5 py-px rounded-full"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
