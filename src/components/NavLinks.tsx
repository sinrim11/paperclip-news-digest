'use client';

/**
 * NavLinks — 상단 내비게이션 (2026-08-29 그룹 재편).
 *
 * 종전엔 15개 링크가 같은 크기·같은 톤으로 한 줄에 늘어서, 매일 쓰는 '추천 매물'과
 * 거의 안 쓰는 'A/B 평가'가 동급이었다. 실사용 빈도에 맞춰 6그룹으로 묶고,
 * 부동산 판단 흐름(찾기 → 따져보기)을 그룹 이름에 반영한다.
 * 데스크톱은 hover 드롭다운, 모바일 드로어는 그룹 헤더 + 들여쓴 항목으로 같은 구조를 유지.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface NavItem { href: string; label: string; desc?: string }
interface NavGroup { label: string; href?: string; items?: NavItem[] }

const GROUPS: NavGroup[] = [
  { label: '오늘', href: '/' },
  {
    label: '매물 찾기',
    items: [
      { href: '/recommend', label: '추천 매물', desc: '오늘의 조건 통과 단지' },
      { href: '/regions', label: '구별 예산맵', desc: '내 예산으로 갈 수 있는 곳' },
      { href: '/listings', label: '전체 매물', desc: '수집된 매물 전수' },
      { href: '/candidates', label: '매물 후보', desc: '스윕 원본 목록' },
    ],
  },
  {
    label: '따져보기',
    items: [
      { href: '/matching', label: '매수 분석', desc: '호가·급매 정합성' },
      { href: '/tracker', label: '예산 트래커', desc: '대출·자기자본 계산' },
      { href: '/versus', label: '집 vs 주식', desc: '기회비용 비교' },
      { href: '/strategy', label: '투자 전략', desc: '방향·원칙' },
      { href: '/guide/policy', label: '정책 가이드', desc: 'LTV·DSR·규제' },
    ],
  },
  { label: '카드뉴스', href: '/cardnews' },
  {
    label: '뉴스',
    items: [
      { href: '/weekly', label: '주간 브리핑' },
      { href: '/search', label: '뉴스 검색' },
      { href: '/ab', label: 'A/B 평가' },
    ],
  },
  { label: '설정', href: '/settings' },
];

export function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const isActive = (href: string) => pathname === href;
  const groupActive = (g: NavGroup) => (g.href ? isActive(g.href) : (g.items ?? []).some((i) => isActive(i.href)));

  return (
    <>
      {/* 데스크톱 — 그룹 드롭다운 (lg 이상) */}
      <nav className="hidden items-center gap-1 text-sm lg:flex">
        {GROUPS.map((g) => {
          const active = groupActive(g);
          if (g.href) {
            return (
              <Link
                key={g.label}
                href={g.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {g.label}
              </Link>
            );
          }
          return (
            <div key={g.label} className="relative" onMouseEnter={() => setOpenGroup(g.label)} onMouseLeave={() => setOpenGroup(null)}>
              <button
                type="button"
                onClick={() => setOpenGroup(openGroup === g.label ? null : g.label)}
                aria-expanded={openGroup === g.label}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {g.label}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" />
                </svg>
              </button>
              {openGroup === g.label && (
                <div className="absolute left-0 top-full z-50 w-60 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
                  {(g.items ?? []).map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      onClick={() => setOpenGroup(null)}
                      aria-current={isActive(i.href) ? 'page' : undefined}
                      className={`block rounded-md px-3 py-2 transition-colors ${
                        isActive(i.href) ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="text-sm font-medium">{i.label}</span>
                      {i.desc && <span className="block text-xs text-gray-400">{i.desc}</span>}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 모바일 — 햄버거 (lg 미만) */}
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
            className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col gap-0.5 overflow-y-auto bg-white p-4 shadow-xl"
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
            {GROUPS.map((g) =>
              g.href ? (
                <Link
                  key={g.label}
                  href={g.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(g.href) ? 'page' : undefined}
                  className={`rounded-md px-3 py-2.5 text-sm font-semibold ${
                    isActive(g.href) ? 'bg-blue-50 text-blue-600' : 'text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  {g.label}
                </Link>
              ) : (
                <div key={g.label} className="mt-2">
                  <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{g.label}</div>
                  {(g.items ?? []).map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      onClick={() => setOpen(false)}
                      aria-current={isActive(i.href) ? 'page' : undefined}
                      className={`block rounded-md px-3 py-2 text-sm ${
                        isActive(i.href) ? 'bg-blue-50 font-semibold text-blue-600' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {i.label}
                    </Link>
                  ))}
                </div>
              ),
            )}
          </nav>
        </div>
      )}
    </>
  );
}
