'use client';

/**
 * BuildGuard (2026-08-10) — 재배포 감지 배너.
 * 서버가 재빌드되면 열려 있던 탭의 서버 액션 ID가 무효화되어 모든 버튼이
 * "An unexpected response was received from the server."로 실패한다.
 * 60초마다 /api/build-id를 폴링해 빌드가 바뀌면 새로고침 배너를 띄운다.
 */

import { useEffect, useRef, useState } from 'react';

export function BuildGuard() {
  const [stale, setStale] = useState(false);
  const initial = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch('/api/build-id', { cache: 'no-store' });
        const { buildId } = (await r.json()) as { buildId: string };
        if (!alive || !buildId || buildId === 'dev') return;
        if (initial.current == null) initial.current = buildId;
        else if (buildId !== initial.current) setStale(true);
      } catch {
        /* 서버 재시작 중 등 일시 실패 — 다음 폴링에서 재시도 */
      }
    };
    check();
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-4 py-2.5 text-sm font-medium text-white">
      새 버전이 배포되었습니다 — 새로고침해야 버튼(생성·전송·게시)이 정상 동작합니다.
      <button
        type="button"
        onClick={() => location.reload()}
        className="rounded bg-white/25 px-3 py-1 font-semibold transition-colors hover:bg-white/40"
      >
        새로고침
      </button>
    </div>
  );
}
