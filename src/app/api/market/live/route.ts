// vercel-react-best-practices §server-actions: thin API route serving live market data to client components
import { NextResponse } from 'next/server';
import { fetchRealMarketData } from '@/lib/market-fetcher';

/** KST today as YYYY-MM-DD */
function todayKST(): string {
  const d = new Date();
  d.setTime(d.getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/market/live
 * Fetches real-time market data from Yahoo Finance and returns it
 * in the flat MarketData shape expected by MarketDashboard.
 * No-cache so clients always get fresh prices.
 */
export async function GET() {
  const date = todayKST();
  const snap = await fetchRealMarketData(date);

  const body = {
    kospiValue:  snap.kospi.value,   kospiChange:  snap.kospi.change,   kospiDir:  snap.kospi.direction,
    kosdaqValue: snap.kosdaq.value,  kosdaqChange: snap.kosdaq.change,  kosdaqDir: snap.kosdaq.direction,
    usdKrwValue: snap.usdKrw.value,  usdKrwChange: snap.usdKrw.change,  usdKrwDir: snap.usdKrw.direction,
    wtiValue:    snap.wti.value,     wtiChange:    snap.wti.change,     wtiDir:    snap.wti.direction,
    us10yValue:  snap.us10y.value,   us10yChange:  snap.us10y.change,   us10yDir:  snap.us10y.direction,
    btcUsdValue: snap.btcUsd.value,  btcUsdChange: snap.btcUsd.change,  btcUsdDir: snap.btcUsd.direction,
    nasdaqValue: snap.nasdaq.value,  nasdaqChange: snap.nasdaq.change,  nasdaqDir: snap.nasdaq.direction,
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
