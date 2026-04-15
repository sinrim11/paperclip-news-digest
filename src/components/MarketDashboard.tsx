'use client';
// vercel-react-best-practices §client-components: needs useEffect/useState for live polling
import { useEffect, useState, useCallback } from 'react';

export interface MarketData {
  kospiValue?: number | null;    kospiChange?: string | null;    kospiDir?: string | null;
  kosdaqValue?: number | null;   kosdaqChange?: string | null;   kosdaqDir?: string | null;
  usdKrwValue?: number | null;   usdKrwChange?: string | null;   usdKrwDir?: string | null;
  wtiValue?: number | null;      wtiChange?: string | null;      wtiDir?: string | null;
  us10yValue?: number | null;    us10yChange?: string | null;    us10yDir?: string | null;
  btcUsdValue?: number | null;   btcUsdChange?: string | null;   btcUsdDir?: string | null;
  nasdaqValue?: number | null;   nasdaqChange?: string | null;   nasdaqDir?: string | null;
  fetchedAt?: string | null;
}

const REFRESH_MS = 5 * 60 * 1000; // refresh every 5 minutes

// Large indices (KOSPI, NASDAQ, BTC) don't need decimals; small values (WTI, US10Y) do.
function fmtValue(v: number): string {
  const decimals = v >= 1000 ? 0 : 2;
  return v.toLocaleString('ko-KR', { maximumFractionDigits: decimals });
}

function fmtAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}시간 전`;
}

function Ticker({
  label,
  value,
  change,
  dir,
}: {
  label: string;
  value?: number | null;
  change?: string | null;
  dir?: string | null;
}) {
  // Korean market convention: up = red, down = blue
  const isUp = dir === 'up';
  const isDown = dir === 'down';
  const badgeCls = isUp
    ? 'bg-red-50 text-red-600 border border-red-200'
    : isDown
    ? 'bg-blue-50 text-blue-600 border border-blue-200'
    : 'bg-gray-50 text-gray-400 border border-gray-100';
  const arrow = isUp ? '▲' : isDown ? '▼' : '–';

  return (
    <div className="flex flex-col gap-1 text-center">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{label}</div>
      <div className="font-bold text-sm tabular-nums text-gray-900 whitespace-nowrap">
        {value != null ? fmtValue(value) : '–'}
      </div>
      <div className={`inline-flex items-center justify-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums mx-auto whitespace-nowrap ${badgeCls}`}>
        <span>{arrow}</span>
        <span>{change ?? '–'}</span>
      </div>
    </div>
  );
}

export function MarketDashboard({ market: initial }: { market: MarketData }) {
  const [market, setMarket] = useState<MarketData>(initial);
  const [fetchedAt, setFetchedAt] = useState<string | null>(initial.fetchedAt ?? null);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0); // forces re-render to update fmtAge display

  const fetchLive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/market/live');
      if (res.ok) {
        const data: MarketData = await res.json();
        setMarket(data);
        setFetchedAt(data.fetchedAt ?? new Date().toISOString());
      }
    } catch {
      // silently keep showing last known data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLive();
    const refreshId = setInterval(fetchLive, REFRESH_MS);
    // tick every 60s so the "X분 전" age label stays accurate
    const tickId = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => {
      clearInterval(refreshId);
      clearInterval(tickId);
    };
  }, [fetchLive]);

  const tickers = [
    { label: 'KOSPI',     value: market.kospiValue,   change: market.kospiChange,   dir: market.kospiDir },
    { label: 'KOSDAQ',    value: market.kosdaqValue,  change: market.kosdaqChange,  dir: market.kosdaqDir },
    { label: 'NASDAQ',    value: market.nasdaqValue,  change: market.nasdaqChange,  dir: market.nasdaqDir },
    { label: 'USD/KRW',   value: market.usdKrwValue,  change: market.usdKrwChange,  dir: market.usdKrwDir },
    { label: 'WTI',       value: market.wtiValue,     change: market.wtiChange,     dir: market.wtiDir },
    { label: '미국채 10Y', value: market.us10yValue,   change: market.us10yChange,   dir: market.us10yDir },
    { label: 'BTC',       value: market.btcUsdValue,  change: market.btcUsdChange,  dir: market.btcUsdDir },
  ];

  return (
    <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 overflow-hidden">
      {/* Header row: title + live badge */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
          시장 스냅샷
        </h3>
        <div className="flex items-center gap-2">
          {fetchedAt && (
            <span className="text-[10px] text-gray-400 tabular-nums">
              {fmtAge(fetchedAt)}
            </span>
          )}
          {loading ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400 animate-pulse" />
              업데이트 중
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* relative wrapper enables the scroll-hint gradient overlay */}
      <div className="relative">
        <div className="overflow-x-auto">
          <div className="flex min-w-max divide-x divide-gray-100">
            {tickers.map((t) => (
              <div key={t.label} className="px-4 first:pl-0 last:pr-0 min-w-[64px]">
                <Ticker {...t} />
              </div>
            ))}
          </div>
        </div>
        {/* scroll-hint fade — mobile only (sm:hidden); pointer-events-none so touch-scroll still works */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent sm:hidden" />
      </div>
    </section>
  );
}
