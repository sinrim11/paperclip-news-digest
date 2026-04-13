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

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => prev && navigate(prev)}
        disabled={!prev}
        className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="이전 날짜"
      >
        ‹
      </button>

      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-bold">{fmt(currentDate)}</h2>
        {sorted.length > 1 && (
          <select
            value={currentDate}
            onChange={(e) => navigate(e.target.value)}
            className="text-xs text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 bg-white cursor-pointer"
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
        className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="다음 날짜"
      >
        ›
      </button>
    </div>
  );
}
