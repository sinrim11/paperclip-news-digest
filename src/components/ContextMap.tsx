'use client';

import { useState } from 'react';
import type { CategoryKey } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/types';

export interface ContextMapItem {
  id: string;
  title: string;
  category: CategoryKey;
  urgency: 'breaking' | 'watch' | 'note';
  contextTags: string[];
  sourceUrl?: string;
}

interface TagGroup {
  tag: string;
  items: ContextMapItem[];
}

const URGENCY_DOT: Record<string, string> = {
  breaking: 'bg-red-500',
  watch: 'bg-yellow-400',
  note: 'bg-blue-400',
};

export function ContextMap({ items }: { items: ContextMapItem[] }) {
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // Build tag → items index
  const tagMap = new Map<string, ContextMapItem[]>();
  for (const item of items) {
    for (const tag of item.contextTags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(item);
    }
  }

  // Only show tags that appear in 2+ items (real connections)
  const tagGroups: TagGroup[] = [...tagMap.entries()]
    .filter(([, its]) => its.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([tag, its]) => ({ tag, items: its }));

  if (!tagGroups.length) return null;

  const activeGroup = activeTag ? tagGroups.find((g) => g.tag === activeTag) : null;

  return (
    <section>
      <h3 className="font-bold text-lg mb-1">🗺️ 맥락 연결 맵</h3>
      <p className="text-xs text-gray-400 mb-4">
        2개 이상의 뉴스에 등장한 태그 — 공통 태그를 클릭하면 관련 뉴스를 확인할 수 있습니다.
      </p>

      {/* Tag cloud */}
      <div className="flex flex-wrap gap-2 mb-6">
        {tagGroups.map((g) => {
          const isActive = activeTag === g.tag;
          const maxCount = tagGroups[0].items.length;
          const heat = Math.round((g.items.length / maxCount) * 5); // 1-5
          return (
            <button
              key={g.tag}
              onClick={() => setActiveTag(isActive ? null : g.tag)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border
                ${isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:text-blue-600'
                }`}
            >
              <span>#{g.tag}</span>
              <span
                className={`text-xs rounded-full px-1.5 font-bold tabular-nums
                  ${isActive ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}
                title={`${g.items.length}건`}
              >
                {g.items.length}
              </span>
              {/* Heat bars */}
              <span className="flex gap-px items-end h-3">
                {[1, 2, 3, 4, 5].map((bar) => (
                  <span
                    key={bar}
                    className={`w-0.5 rounded-sm transition-all
                      ${bar <= heat
                        ? isActive ? 'bg-blue-200' : 'bg-blue-400'
                        : isActive ? 'bg-blue-700' : 'bg-gray-200'
                      }`}
                    style={{ height: `${bar * 2 + 2}px` }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Connected news panel */}
      {activeGroup && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <h4 className="font-semibold text-blue-800 mb-3">
            #{activeGroup.tag} — {activeGroup.items.length}건 연결
          </h4>
          <div className="space-y-3">
            {activeGroup.items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 bg-white rounded-lg border border-blue-100 p-3"
              >
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${URGENCY_DOT[item.urgency]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
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
                  {/* Other shared tags */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {item.contextTags
                      .filter((t) => t !== activeGroup.tag && tagMap.has(t) && tagMap.get(t)!.length >= 2)
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => setActiveTag(t)}
                          className="text-xs text-blue-500 hover:text-blue-700 hover:underline"
                        >
                          #{t}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary table: top cross-cutting tags */}
      {!activeGroup && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {tagGroups.slice(0, 6).map((g) => (
            <button
              key={g.tag}
              onClick={() => setActiveTag(g.tag)}
              className="text-left bg-white rounded-lg border border-gray-200 p-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
            >
              <div className="font-medium text-sm text-gray-800">#{g.tag}</div>
              <div className="text-xs text-gray-400 mt-1">{g.items.length}건 연결</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {[...new Set(g.items.map((i) => i.category))].map((cat) => (
                  <span key={cat} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                    {CATEGORY_LABEL[cat] ?? cat}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
