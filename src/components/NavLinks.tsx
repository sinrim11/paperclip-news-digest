'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const LINKS = [
  { href: '/', label: '오늘' },
  { href: '/weekly', label: '주간' },
  { href: '/strategy', label: '투자 전략' },
  { href: '/recommend', label: '추천 매물' },
  { href: '/candidates', label: '매물 후보' },
  { href: '/listings', label: '전체 매물' },
  { href: '/matching', label: '매수 분석' },
  { href: '/versus', label: '집vs주식' },
  { href: '/tracker', label: '트래커' },
  { href: '/cardnews', label: '카드뉴스' },
  { href: '/settings', label: '설정' },
  { href: '/guide/policy', label: '정책 가이드' },
  { href: '/search', label: '검색' },
  { href: '/ab', label: 'A/B 평가' },
];

export function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 데스크톱 — 인라인 네비 (lg 이상) */}
      <nav className="hidden gap-3 text-[13px] lg:flex [&_a]:whitespace-nowrap">
        {LINKS.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive
                  ? 'border-b-2 border-blue-600 pb-0.5 font-semibold text-blue-600'
                  : 'text-gray-500 transition-colors hover:text-gray-900'
              }
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* 모바일 — 햄버거 버튼 (lg 미만) */}
      <button
        type="button"
        aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center rounded-md p-2 text-gray-600 hover:bg-gray-100 lg:hidden"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {/* 모바일 — 드로어 */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <nav
            className="absolute right-0 top-0 flex h-full w-64 max-w-[80vw] flex-col gap-1 overflow-y-auto bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-500">메뉴</span>
              <button
                type="button"
                aria-label="메뉴 닫기"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {LINKS.map(({ href, label }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'rounded-md bg-blue-50 px-3 py-2.5 text-sm font-semibold text-blue-600'
                      : 'rounded-md px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100'
                  }
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
