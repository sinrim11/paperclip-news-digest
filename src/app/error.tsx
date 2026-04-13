'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="text-center py-20 text-gray-400">
      <p className="text-6xl mb-4">⚠️</p>
      <p className="text-xl mb-2">오류가 발생했습니다.</p>
      <p className="text-sm text-gray-500 mb-4">{error.message}</p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
      >
        다시 시도
      </button>
    </div>
  );
}
