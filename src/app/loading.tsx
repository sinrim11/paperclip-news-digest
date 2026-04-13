// vercel-react-best-practices §async-suspense-boundaries: loading.tsx = Suspense fallback
// Skeleton layout matches the real page structure to prevent layout shift

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-100 ${className ?? ''}`} />
  );
}

function MarketSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <Skeleton className="h-2.5 w-24 mb-4" />
      <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-gray-100">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`flex flex-col items-center gap-2 ${i > 0 ? 'pl-4' : ''}`}>
            <Skeleton className="h-2 w-10" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-10 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Top3Skeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TabsSkeleton() {
  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 pb-1 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className={`h-8 rounded-t ${i === 0 ? 'w-20' : 'w-16'}`} />
        ))}
      </div>
      {/* News card rows */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-l-4 border-gray-200 rounded-r-lg border border-l-0 border-gray-100 p-4 space-y-2">
            <div className="flex gap-2">
              <Skeleton className="h-3 w-4" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-16 rounded-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
            <div className="ml-6 space-y-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-4/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-8">
      {/* DateNavigator skeleton */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-lg" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-11 w-11 rounded-lg" />
      </div>

      <MarketSkeleton />
      <Top3Skeleton />
      <TabsSkeleton />
    </div>
  );
}
