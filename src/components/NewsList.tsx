// vercel-react-best-practices §rerender: RSC — no "use client", pure Tailwind styling
import type { CategoryKey, Urgency } from '@/lib/types';
import { UrgencyBadge } from './UrgencyBadge';

export interface NewsListItem {
  id: string;
  title: string;
  urgency: Urgency;
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
  isTop3: boolean;
  top3Rank?: number | null;
  category?: CategoryKey;
}

const URGENCY_BORDER: Record<Urgency, string> = {
  breaking: 'border-l-red-500',
  watch: 'border-l-yellow-400',
  note: 'border-l-gray-300',
};

function NewsListRow({ item, index }: { item: NewsListItem; index: number }) {
  return (
    <article className={`border-l-4 ${URGENCY_BORDER[item.urgency]} bg-white rounded-r-lg border border-l-0 border-gray-100 p-4 shadow-sm hover:shadow-md hover:bg-gray-50/50 transition-all duration-200 ease-out group`}>
      {/* Title row */}
      <div className="flex items-start gap-2 mb-2">
        {index >= 0 && (
          <span className="text-xs text-gray-300 font-mono mt-0.5 w-5 shrink-0 text-right select-none">
            {index + 1}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <UrgencyBadge urgency={item.urgency} />
            {item.isTop3 && item.top3Rank && (
              <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-semibold">
                TOP {item.top3Rank}
              </span>
            )}
          </div>
          <h4 className="font-semibold text-sm leading-snug text-gray-900">
            {item.sourceUrl ? (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-600 hover:underline underline-offset-2 decoration-blue-300 transition-colors duration-150"
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h4>
        </div>
      </div>

      {/* 3-line summary */}
      <div className={`${index >= 0 ? 'ml-7' : ''} space-y-1 text-xs text-gray-600 leading-relaxed`}>
        <p><span className="font-semibold text-gray-700">📌</span> {item.fact}</p>
        <p><span className="font-semibold text-gray-700">💡</span> {item.impact}</p>
        <p><span className="font-semibold text-gray-700">🎯</span> {item.action}</p>
      </div>

      {/* Context tags + source */}
      {(item.contextTags.length > 0 || item.source) && (
        <div className={`${index >= 0 ? 'ml-7' : ''} mt-2.5 flex items-center justify-between gap-2 flex-wrap`}>
          <div className="flex flex-wrap gap-1">
            {item.contextTags.map((tag) => (
              <span
                key={tag}
                className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full group-hover:bg-blue-100 transition-colors duration-150"
              >
                #{tag}
              </span>
            ))}
          </div>
          {item.source && (
            <span className="text-xs text-gray-400 shrink-0 italic">{item.source}</span>
          )}
        </div>
      )}
    </article>
  );
}

export function NewsList({
  items,
  showNumbers = true,
}: {
  items: NewsListItem[];
  showNumbers?: boolean;
}) {
  if (!items.length) return null;

  const breaking = items.filter((i) => i.urgency === 'breaking');
  const watch = items.filter((i) => i.urgency === 'watch');
  const note = items.filter((i) => i.urgency === 'note');

  const groups: Array<{ label: string; items: NewsListItem[] }> = [
    { label: '🔴 Breaking', items: breaking },
    { label: '🟡 Watch', items: watch },
    { label: '🔵 Note', items: note },
  ].filter((g) => g.items.length > 0);

  // If all same urgency, skip grouping
  if (groups.length === 1) {
    return (
      <div className="space-y-3">
        {items.map((item, i) => (
          <NewsListRow key={item.id} item={item} index={showNumbers ? i : -1} />
        ))}
      </div>
    );
  }

  let globalIdx = 0;
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            {group.label} ({group.items.length})
          </h5>
          <div className="space-y-3">
            {group.items.map((item) => {
              const idx = globalIdx++;
              return <NewsListRow key={item.id} item={item} index={showNumbers ? idx : -1} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
