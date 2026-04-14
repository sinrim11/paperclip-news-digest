// vercel-react-best-practices §rerender: "use client" justified — tab switching + urgency filter require useState
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
  const [urgencyFilter, setUrgencyFilter] = useState<Urgency | null>(null);

  const active = categories.find((c) => c.key === activeKey) ?? categories[0];
  if (!active) return null;

  const breakingCount = (c: CategoryTabData) =>
    c.items.filter((i) => i.urgency === 'breaking').length;

  function handleTabChange(key: CategoryKey) {
    setActiveKey(key);
    setUrgencyFilter(null); // reset filter on tab switch
  }

  function handleUrgencyFilter(u: Urgency) {
    setUrgencyFilter((prev) => (prev === u ? null : u)); // toggle
  }

  const visibleItems = urgencyFilter
    ? active.items.filter((i) => i.urgency === urgencyFilter)
    : active.items;

  return (
    <section>
      {/* Tab bar — role=tablist required by ARIA tabs pattern */}
      <div
        role="tablist"
        aria-label="뉴스 카테고리"
        className="flex gap-1 overflow-x-auto pb-1 mb-4 border-b border-gray-200 scrollbar-hide"
      >
        {categories.map((cat) => {
          const isActive = cat.key === activeKey;
          const bc = breakingCount(cat);
          return (
            <button
              key={cat.key}
              id={`tab-${cat.key}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${cat.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleTabChange(cat.key)}
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

      {/* Active category content — role=tabpanel links to active tab via aria-labelledby */}
      <div
        key={activeKey}
        id={`tabpanel-${activeKey}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeKey}`}
        className="animate-fade-in"
      >
        {active.summary && (
          <div className="text-sm text-gray-600 bg-white rounded-lg border border-gray-100 px-4 py-3 mb-4 flex items-start gap-2">
            <span className="text-gray-400 mt-0.5">💬</span>
            <p>{active.summary}</p>
          </div>
        )}

        {/* Urgency filter buttons — role=group labels the filter set for screen readers */}
        <div role="group" aria-label="긴급도 필터" className="flex flex-wrap items-center gap-2 mb-3">
          {(['breaking', 'watch', 'note'] as Urgency[]).map((u) => {
            const count = active.items.filter((i) => i.urgency === u).length;
            if (!count) return null;
            const isFilterActive = urgencyFilter === u;
            return (
              <button
                key={u}
                onClick={() => handleUrgencyFilter(u)}
                aria-pressed={isFilterActive}
                className={`flex items-center gap-1 rounded-full transition-all duration-150
                  ${isFilterActive
                    ? 'ring-2 ring-offset-1 ring-gray-400 scale-105'
                    : 'opacity-70 hover:opacity-100'
                  }`}
              >
                <UrgencyBadge urgency={u} />
                <span className="text-xs text-gray-400 pr-1">{count}건</span>
              </button>
            );
          })}
          {urgencyFilter && (
            <button
              onClick={() => setUrgencyFilter(null)}
              className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
            >
              전체보기
            </button>
          )}
          {urgencyFilter && (
            <span className="text-xs text-gray-400 ml-auto">
              {visibleItems.length} / {active.items.length}건
            </span>
          )}
        </div>

        <div className="space-y-3">
          {visibleItems.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}
