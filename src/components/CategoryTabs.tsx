// vercel-react-best-practices §rerender: "use client" justified — tab switching requires useState
'use client';

import { useState } from 'react';
import type { CategoryKey, Urgency } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/types';
import { NewsCard } from './NewsCard';
import { UrgencyBadge } from './UrgencyBadge';

export interface CategoryTabItem {
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
}

export interface CategoryTabData {
  key: CategoryKey;
  summary: string;
  items: CategoryTabItem[];
}

const CATEGORY_ICON: Record<CategoryKey, string> = {
  GLOBAL:     '🌐',
  STOCKS:     '📈',
  AI:         '🤖',
  POLICY:     '🏛️',
  REALESTATE: '🏠',
};

export function CategoryTabs({ categories }: { categories: CategoryTabData[] }) {
  const [activeKey, setActiveKey] = useState<CategoryKey>(
    categories[0]?.key ?? 'GLOBAL',
  );

  const active = categories.find((c) => c.key === activeKey) ?? categories[0];
  if (!active) return null;

  const breakingCount = (c: CategoryTabData) =>
    c.items.filter((i) => i.urgency === 'breaking').length;

  return (
    <section>
      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-4 border-b border-gray-200 scrollbar-hide">
        {categories.map((cat) => {
          const isActive = cat.key === activeKey;
          const bc = breakingCount(cat);
          return (
            <button
              key={cat.key}
              onClick={() => setActiveKey(cat.key)}
              aria-selected={isActive}
              role="tab"
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t
                border-b-2 transition-all duration-200 ease-out
                ${isActive
                  ? 'text-blue-700 border-blue-600 bg-blue-50'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                }`}
            >
              <span>{CATEGORY_ICON[cat.key]}</span>
              <span>{CATEGORY_LABEL[cat.key]}</span>
              <span className={`text-xs transition-colors duration-200 ${isActive ? 'text-blue-500' : 'text-gray-400'}`}>
                {cat.items.length}
              </span>
              {bc > 0 && (
                <span className="text-xs bg-red-500 text-white rounded-full px-1 leading-tight">
                  {bc}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active category content — key forces remount so fade-in re-triggers on tab switch */}
      <div key={activeKey} className="animate-fade-in">
        {active.summary && (
          <div className="text-sm text-gray-600 bg-white rounded-lg border border-gray-100 px-4 py-3 mb-4 flex items-start gap-2">
            <span className="text-gray-400 mt-0.5">💬</span>
            <p>{active.summary}</p>
          </div>
        )}

        {/* Urgency filter hint */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(['breaking', 'watch', 'note'] as Urgency[]).map((u) => {
            const count = active.items.filter((i) => i.urgency === u).length;
            if (!count) return null;
            return (
              <span key={u} className="flex items-center gap-1">
                <UrgencyBadge urgency={u} />
                <span className="text-xs text-gray-400">{count}건</span>
              </span>
            );
          })}
        </div>

        <div className="space-y-3">
          {active.items.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
