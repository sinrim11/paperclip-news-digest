// vercel-react-best-practices §async-suspense-boundaries: loading.tsx = Suspense fallback
function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className ?? ''}`} />;
}

export default function WeeklyLoading() {
  return (
    <div className="space-y-8">
      {/* Page header skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Sparkline cards skeleton */}
      <div>
        <Skeleton className="h-5 w-36 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-12 w-full rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Weekly category tabs skeleton */}
      <div>
        <div className="flex gap-1 border-b border-gray-200 pb-1 mb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={`h-8 rounded-t ${i === 0 ? 'w-20' : 'w-16'}`} />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-4 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <div className="space-y-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
