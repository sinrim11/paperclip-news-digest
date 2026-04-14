'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Silently polls router.refresh() every `intervalMs` ms.
 * Used when a digest is in_progress so the page auto-updates
 * when generation completes — no manual refresh needed.
 */
export function ProgressPoller({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
