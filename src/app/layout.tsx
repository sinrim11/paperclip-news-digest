import type { Metadata } from 'next';
import Link from 'next/link';
import { NavLinks } from '@/components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: '뉴스 다이제스트',
  description: '매일 아침 의사결정자를 위한 AI 뉴스 브리핑',
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
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <Link href="/" className="text-xl font-bold hover:opacity-80 transition-opacity">
              📰 뉴스 다이제스트
            </Link>
            <NavLinks />
          </div>
        </header>
        <main id="main-content" className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
