'use client';

import { useRouter } from 'next/navigation';

export function DateNavigator({
  currentDate,
  availableDates,
}: {
  currentDate: string;
  availableDates: string[];
}) {
  const router = useRouter();

  const sorted = [...availableDates].sort();
  const idx = sorted.indexOf(currentDate);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    });

  const navigate = (date: string) => {
    const today = new Date().toISOString().slice(0, 10);
    if (date === today) {
      router.push('/');
    } else {
      router.push(`/?date=${date}`);
    }
  };

  // Use KST (UTC+9) to match the server-side todayKST() used in page.tsx
  const d = new Date();
  d.setTime(d.getTime() + 9 * 60 * 60 * 1000);
  const today = d.toISOString().slice(0, 10);
  const isToday = currentDate === today;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        {/* Touch target: min 44×44px per WCAG 2.5.5 */}
        <button
          onClick={() => prev && navigate(prev)}
          disabled={!prev}
          className="flex min-w-[44px] h-[44px] items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-lg"
          aria-label="이전 날짜"
        >
          ‹
        </button>

        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold sm:text-2xl">{fmt(currentDate)}</h2>
          {sorted.length > 1 && (
            <select
              value={currentDate}
              onChange={(e) => navigate(e.target.value)}
              aria-label="날짜 선택"
              className="hidden sm:block text-xs text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 bg-white cursor-pointer"
            >
              {[...sorted].reverse().map((d) => (
                <option key={d} value={d}>
                  {new Date(d).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          onClick={() => next && navigate(next)}
          disabled={!next}
          className="flex min-w-[44px] h-[44px] items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-lg"
          aria-label="다음 날짜"
        >
          ›
        </button>
      </div>

      {/* Today shortcut — only shown on past dates */}
      {!isToday && (
        <button
          onClick={() => navigate(today)}
          className="self-start text-xs text-blue-600 hover:underline px-1"
        >
          → 오늘로 돌아가기
        </button>
      )}
    </div>
  );
}
