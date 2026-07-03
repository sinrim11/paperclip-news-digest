'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function todayKST(): string {
  const d = new Date();
  d.setTime(d.getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Silently polls router.refresh() every `intervalMs` ms.
 * Used when a digest is in_progress so the page auto-updates
 * when generation completes — no manual refresh needed.
 *
 * If the KST date rolls over midnight while polling (dateStr no longer
 * matches today), navigates cleanly to the new day instead of doing a
 * soft RSC refresh. A soft refresh across a date change swaps out the
 * entire component tree (full digest → empty state), which can leave
 * React events unresponsive during reconciliation.
 */
export function ProgressPoller({
  intervalMs = 10_000,
  dateStr,
}: {
  intervalMs?: number;
  dateStr: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      const today = todayKST();
      if (dateStr !== today) {
        // Date has rolled past midnight — navigate to the new day's page
        // with a full client navigation rather than a soft RSC refresh.
        // This avoids React reconciling a dramatically different component
        // tree (which can briefly break event handlers).
        router.push('/');
      } else {
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs, dateStr]);

  return null;
}
