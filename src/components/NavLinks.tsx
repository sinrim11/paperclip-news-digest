'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: '오늘' },
    { href: '/weekly', label: '주간' },
  ];

  return (
    <nav className="flex gap-4 text-sm">
      {links.map(({ href, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'font-semibold text-blue-600 border-b-2 border-blue-600 pb-0.5'
                : 'text-gray-500 hover:text-gray-900 transition-colors'
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
