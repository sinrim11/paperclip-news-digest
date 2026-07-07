import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NavLinks } from '@/components/NavLinks';
import { SearchBar } from '@/components/SearchBar';
import './globals.css';

export const metadata: Metadata = {
  title: '뉴스 다이제스트',
  description: '매일 아침 의사결정자를 위한 AI 뉴스 브리핑',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {/* Skip navigation for keyboard/screen-reader users (N2) */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          메인 콘텐츠로 건너뛰기
        </a>
        <header className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <Link href="/" className="shrink-0 text-lg font-bold transition-opacity hover:opacity-80 sm:text-xl">
              📰 뉴스 다이제스트
            </Link>
            <div className="flex items-center gap-2 sm:gap-4">
              {/* 검색바는 데스크톱 헤더에만 — 모바일은 네비 '검색' 링크로 이동 */}
              <div className="hidden md:block">
                <Suspense>
                  <SearchBar />
                </Suspense>
              </div>
              <NavLinks />
            </div>
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
