'use client';
import { useState } from 'react';
import { IssueTimeline, type TimelineNewsItem } from './IssueTimeline';

export interface CategorySummaryItem {
  category: string;
  summary: string;
  progression: string;
  highlight: string;
}

const CATEGORY_ICON: Record<string, string> = {
  '글로벌':   '🌐',
  '증권':     '📈',
  'AI':       '🤖',
  '정부정책': '🏛️',
  '부동산':   '🏠',
};

export function WeeklyCategoryTabs({
  summaries,
  timelineItems,
}: {
  summaries: CategorySummaryItem[];
  timelineItems: TimelineNewsItem[];
}) {
  const [active, setActive] = useState(summaries[0]?.category ?? '');
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  if (!summaries.length) return null;

  const current = summaries.find((s) => s.category === active);

  // Best-effort: match timeline items whose title/tags relate to the highlight keyword
  const highlightItems: TimelineNewsItem[] =
    expandedTag
      ? timelineItems.filter(
          (t) =>
            t.category === active ||
            t.title.includes(expandedTag) ||
            t.contextTags.some((tag) => tag.includes(expandedTag) || expandedTag.includes(tag))
        )
      : [];

  return (
    <section>
      <h3 className="font-bold text-lg mb-4">카테고리별 주간 요약</h3>

      {/* Tab strip */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-4">
        {summaries.map((s) => (
          <button
            key={s.category}
            onClick={() => {
              setActive(s.category);
              setExpandedTag(null);
            }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active === s.category
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {CATEGORY_ICON[s.category] ?? '📋'} {s.category}
          </button>
        ))}
      </div>

      {current && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <p className="text-sm text-gray-700 leading-relaxed">{current.summary}</p>

          {current.progression && (
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                주간 흐름
              </span>
              <p className="text-sm text-gray-600 mt-0.5">{current.progression}</p>
            </div>
          )}

          {current.highlight && (
            <div>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1">
                하이라이트
              </span>
              <button
                onClick={() =>
                  setExpandedTag(expandedTag === current.highlight ? null : current.highlight)
                }
                className="w-full text-left text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline flex items-center justify-between"
              >
                <span>{current.highlight}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {expandedTag === current.highlight ? '▲ 닫기' : '▼ 타임라인 보기'}
                </span>
              </button>

              {expandedTag === current.highlight && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  {highlightItems.length > 0 ? (
                    <IssueTimeline items={highlightItems} />
                  ) : (
                    <p className="text-xs text-gray-400">관련 타임라인 항목이 없습니다.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
