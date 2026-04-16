'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { CategoryKey } from '@/lib/types';

const CATEGORIES: { key: string; label: string }[] = [
  { key: '', label: '전체 카테고리' },
  { key: 'GLOBAL', label: '글로벌' },
  { key: 'STOCKS', label: '증권' },
  { key: 'AI', label: 'AI' },
  { key: 'POLICY', label: '정치' },
  { key: 'REALESTATE', label: '부동산' },
];

const URGENCIES: { key: string; label: string }[] = [
  { key: '', label: '전체 긴급도' },
  { key: 'breaking', label: '🔴 Breaking' },
  { key: 'watch', label: '🟡 Watch' },
  { key: 'note', label: '🔵 Note' },
];

/**
 * Filter bar for the /search results page.
 * Reads current URL params and navigates on change.
 */
export function SearchFilters() {
  const router = useRouter();
  const sp = useSearchParams();
  const [category, setCategory] = useState(sp.get('category') ?? '');
  const [urgency, setUrgency] = useState(sp.get('urgency') ?? '');
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [to, setTo] = useState(sp.get('to') ?? '');
  const [, startTransition] = useTransition();

  function navigate(overrides: Record<string, string>) {
    const params = new URLSearchParams();
    const vals = { category, urgency, from, to, ...overrides };
    const q = sp.get('q');
    if (q) params.set('q', q);
    if (vals.category) params.set('category', vals.category);
    if (vals.urgency) params.set('urgency', vals.urgency);
    if (vals.from) params.set('from', vals.from);
    if (vals.to) params.set('to', vals.to);
    startTransition(() => router.push(`/search?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <select
        value={category}
        onChange={(e) => { setCategory(e.target.value); navigate({ category: e.target.value }); }}
        className="border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {CATEGORIES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
      </select>
      <select
        value={urgency}
        onChange={(e) => { setUrgency(e.target.value); navigate({ urgency: e.target.value }); }}
        className="border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {URGENCIES.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
      </select>
      <input
        type="date" value={from}
        onChange={(e) => { setFrom(e.target.value); navigate({ from: e.target.value }); }}
        className="border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        title="시작 날짜"
      />
      <span className="self-center text-gray-400">~</span>
      <input
        type="date" value={to}
        onChange={(e) => { setTo(e.target.value); navigate({ to: e.target.value }); }}
        className="border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        title="종료 날짜"
      />
    </div>
  );
}

/**
 * Compact keyword search bar for the global header.
 * Navigates to /search?q=... after 300ms of idle typing.
 */
export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) return;
    timerRef.current = setTimeout(() => {
      startTransition(() => {
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      });
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, router]);

  return (
    <div className="relative flex items-center">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) {
            if (timerRef.current) clearTimeout(timerRef.current);
            startTransition(() => {
              router.push(`/search?q=${encodeURIComponent(query.trim())}`);
            });
          }
        }}
        placeholder="뉴스 검색…"
        aria-label="뉴스 키워드 검색"
        className="w-48 sm:w-64 border border-gray-300 rounded-full px-3 py-1.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:w-72 transition-all"
      />
      {isPending ? (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">…</span>
      ) : (
        <svg
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
      )}
    </div>
  );
}
