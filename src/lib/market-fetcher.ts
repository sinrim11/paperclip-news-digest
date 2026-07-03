/**
 * market-fetcher.ts
 * Fetches live market data from Yahoo Finance API.
 * Replaces LLM-based (hallucinated) market estimation with real prices.
 */
import type { MarketSnapshot, MarketIndicator } from './types';

async function fetchSymbol(
  symbol: string,
): Promise<{ price: number; prev: number } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsDigestBot/1.0)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chart: { result: Array<{ meta: { regularMarketPrice?: number; previousClose?: number; chartPreviousClose?: number } }> };
    };
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const prev  = meta.previousClose ?? meta.chartPreviousClose ?? null;
    if (price == null || prev == null) return null;
    return { price, prev };
  } catch {
    return null;
  }
}

function toIndicator(
  price: number,
  prev: number,
  isAbsoluteDiff = false,
): MarketIndicator {
  const diff = price - prev;
  const pct  = (diff / prev) * 100;
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(pct) < 0.05 ? 'flat' : pct > 0 ? 'up' : 'down';
  const change = isAbsoluteDiff
    ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`
    : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  return { value: Math.round(price * 100) / 100, change, direction };
}

/**
 * Fetches a live MarketSnapshot using Yahoo Finance.
 * Each symbol is fetched independently — a failure returns a zero indicator
 * for that field rather than throwing.
 */
export async function fetchRealMarketData(date: string): Promise<MarketSnapshot> {
  const zero = (isAbs = false): MarketIndicator => ({
    value: 0,
    change: isAbs ? '0.00' : '0.00%',
    direction: 'flat',
  });

  const [kospi, kosdaq, usdKrw, wti, us10y, btcUsd, nasdaq] = await Promise.allSettled([
    fetchSymbol('^KS11'),
    fetchSymbol('^KQ11'),
    fetchSymbol('KRW=X'),
    fetchSymbol('CL=F'),
    fetchSymbol('^TNX'),
    fetchSymbol('BTC-USD'),
    fetchSymbol('^IXIC'),
  ]);

  const ok = <T>(r: PromiseSettledResult<T>): T | null =>
    r.status === 'fulfilled' ? r.value : null;

  const k  = ok(kospi);
  const kq = ok(kosdaq);
  const fx = ok(usdKrw);
  const w  = ok(wti);
  const t  = ok(us10y);
  const b  = ok(btcUsd);
  const nd = ok(nasdaq);

  return {
    date,
    kospi:  k  ? toIndicator(k.price,  k.prev)        : zero(),
    kosdaq: kq ? toIndicator(kq.price, kq.prev)       : zero(),
    usdKrw: fx ? toIndicator(fx.price, fx.prev, true) : zero(true),
    wti:    w  ? toIndicator(w.price,  w.prev)         : zero(),
    us10y:  t  ? toIndicator(t.price,  t.prev,  true) : zero(true),
    btcUsd: b  ? toIndicator(b.price,  b.prev)         : zero(),
    nasdaq: nd ? toIndicator(nd.price, nd.prev)        : zero(),
  };
}
