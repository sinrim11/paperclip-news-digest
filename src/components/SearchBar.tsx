'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState, useTransition } from 'react';
import { CATEGORY_LABEL, type CategoryKey } from '@/lib/types';

const CATEGORIES: { key: CategoryKey | ''; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'GLOBAL', label: '글로벌' },
  { key: 'STOCKS', label: '증권' },
  { key: 'AI', label: 'AI' },
  { key: 'POLICY', label: '정치' },
  { key: 'REALESTATE', label: '부동산' },
];

const URGENCIES: { key: string; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'breaking', label: '🔴 Breaking' },
  { key: 'watch', label: '🟡 Watch' },
  { key: 'note', label: '🔵 Note' },
];

export function SearchBar() {
  const router = useRouter();
  const existing = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState(existing.get('q') ?? '');
  const [category, setCategory] = useState(existing.get('category') ?? '');
  const [urgency, setUrgency] = useState(existing.get('urgency') ?? '');
  const [from, setFrom] = useState(existing.get('from') ?? '');
  const [to, setTo] = useState(existing.get('to') ?? '');

  const submit = useCallback(
    (overrides?: Partial<{ q: string; category: string; urgency: string; from: string; to: string }>) => {
      const params = new URLSearchParams();
      const q = overrides?.q ?? query;
      const cat = overrides?.category ?? category;
      const urg = overrides?.urgency ?? urgency;
      const f = overrides?.from ?? from;
      const t = overrides?.to ?? to;

      if (q) params.set('q', q);
      if (cat) params.set('category', cat);
      if (urg) params.set('urgency', urg);
      if (f) params.set('from', f);
      if (t) params.set('to', t);

      startTransition(() => {
        router.push(`/search?${params.toString()}`);
      });
    },
    [query, category, urgency, from, to, router],
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
      {/* Keyword input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="키워드 검색 (제목, 요약, 태그)"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => submit()}
          disabled={isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? '검색 중…' : '검색'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 text-sm">
        {/* Category filter */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {CATEGORIES.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {/* Urgency filter */}
        <select
          value={urgency}
          onChange={(e) => setUrgency(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {URGENCIES.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        {/* Date range */}
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="시작 날짜"
        />
        <span className="self-center text-gray-400">~</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          title="종료 날짜"
        />
      </div>
    </div>
  );
}
