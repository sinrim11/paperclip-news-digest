export interface MarketData {
  kospiValue?: number | null;    kospiChange?: string | null;    kospiDir?: string | null;
  kosdaqValue?: number | null;   kosdaqChange?: string | null;   kosdaqDir?: string | null;
  usdKrwValue?: number | null;   usdKrwChange?: string | null;   usdKrwDir?: string | null;
  wtiValue?: number | null;      wtiChange?: string | null;      wtiDir?: string | null;
  us10yValue?: number | null;    us10yChange?: string | null;    us10yDir?: string | null;
  btcUsdValue?: number | null;   btcUsdChange?: string | null;   btcUsdDir?: string | null;
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
  const dirColor =
    dir === 'up' ? 'text-red-500' : dir === 'down' ? 'text-blue-500' : 'text-gray-400';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';

  return (
    <div className="text-center">
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="font-bold text-sm tabular-nums">
        {value != null ? value.toLocaleString() : '–'}
      </div>
      <div className={`text-xs tabular-nums ${dirColor}`}>
        {arrow} {change ?? '–'}
      </div>
    </div>
  );
}

export function MarketDashboard({ market }: { market: MarketData }) {
  const tickers = [
    { label: 'KOSPI',   value: market.kospiValue,   change: market.kospiChange,   dir: market.kospiDir },
    { label: 'KOSDAQ',  value: market.kosdaqValue,  change: market.kosdaqChange,  dir: market.kosdaqDir },
    { label: 'USD/KRW', value: market.usdKrwValue,  change: market.usdKrwChange,  dir: market.usdKrwDir },
    { label: 'WTI',     value: market.wtiValue,     change: market.wtiChange,     dir: market.wtiDir },
    { label: '미국채10Y', value: market.us10yValue,  change: market.us10yChange,   dir: market.us10yDir },
    { label: 'BTC',     value: market.btcUsdValue,  change: market.btcUsdChange,  dir: market.btcUsdDir },
  ];

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
        시장 스냅샷
      </h3>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
        {tickers.map((t) => (
          <Ticker key={t.label} {...t} />
        ))}
      </div>
    </section>
  );
}
