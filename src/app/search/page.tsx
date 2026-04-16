import { Suspense } from 'react';
import { SearchFilters } from '@/components/SearchBar';
import { UrgencyBadge } from '@/components/UrgencyBadge';
import { CATEGORY_LABEL, type CategoryKey } from '@/lib/types';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SearchItem {
  id: string;
  digestDate: string;
  category: CategoryKey;
  urgency: 'breaking' | 'watch' | 'note';
  title: string;
  fact: string;
  impact: string;
  action: string;
  contextTags: string[];
  source: string;
  sourceUrl: string;
  isTop3: boolean;
  top3Rank: number | null;
}

interface SearchResult {
  total: number;
  page: number;
  pages: number;
  limit: number;
  items: SearchItem[];
}

async function fetchSearchResults(params: URLSearchParams): Promise<SearchResult | null> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/search?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams?: Record<string, string>;
}) {
  const params = new URLSearchParams();
  if (searchParams?.q) params.set('q', searchParams.q);
  if (searchParams?.category) params.set('category', searchParams.category);
  if (searchParams?.urgency) params.set('urgency', searchParams.urgency);
  if (searchParams?.from) params.set('from', searchParams.from);
  if (searchParams?.to) params.set('to', searchParams.to);
  if (searchParams?.page) params.set('page', searchParams.page);

  const hasQuery = params.toString().length > 0;
  const result = hasQuery ? await fetchSearchResults(params) : null;

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">뉴스 검색</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 홈으로</Link>
      </div>

      <Suspense>
        <SearchFilters />
      </Suspense>

      {/* Results */}
      {hasQuery && (
        <div className="space-y-4">
          {result === null ? (
            <p className="text-red-500 text-sm">검색 중 오류가 발생했습니다.</p>
          ) : result.total === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">검색 결과가 없습니다.</p>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                총 <span className="font-semibold text-gray-800">{result.total}</span>건
                {result.pages > 1 && ` (${result.page} / ${result.pages} 페이지)`}
              </p>

              <div className="space-y-3">
                {result.items.map((item) => (
                  <article
                    key={item.id}
                    className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                          {CATEGORY_LABEL[item.category]}
                        </span>
                        <UrgencyBadge urgency={item.urgency} />
                        <Link
                          href={`/?date=${item.digestDate}`}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          {item.digestDate}
                        </Link>
                        {item.isTop3 && (
                          <span className="text-xs font-bold text-amber-500">★ TOP{item.top3Rank}</span>
                        )}
                      </div>
                    </div>

                    <h2 className="font-semibold text-gray-900 text-sm leading-snug">
                      {item.sourceUrl ? (
                        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </h2>

                    <div className="text-sm text-gray-700 space-y-1">
                      <p><span className="text-gray-400">📌</span> {item.fact}</p>
                      <p><span className="text-gray-400">💡</span> {item.impact}</p>
                      <p><span className="text-gray-400">🎯</span> {item.action}</p>
                    </div>

                    {item.contextTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.contextTags.map((tag) => (
                          <Link
                            key={tag}
                            href={`/search?q=${encodeURIComponent(tag)}`}
                            className="text-xs bg-blue-50 text-blue-600 rounded-full px-2 py-0.5 hover:bg-blue-100 transition-colors"
                          >
                            #{tag}
                          </Link>
                        ))}
                      </div>
                    )}

                    <p className="text-xs text-gray-400">{item.source}</p>
                  </article>
                ))}
              </div>

              {/* Pagination */}
              {result.pages > 1 && (
                <div className="flex justify-center gap-2 pt-2">
                  {Array.from({ length: result.pages }, (_, i) => i + 1).map((p) => {
                    const ps = new URLSearchParams(params);
                    ps.set('page', String(p));
                    return (
                      <Link
                        key={p}
                        href={`/search?${ps.toString()}`}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                          p === result.page
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {p}
                      </Link>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!hasQuery && (
        <p className="text-gray-400 text-sm text-center py-8">
          키워드를 입력하거나 필터를 선택해 검색하세요.
        </p>
      )}
    </main>
  );
}
