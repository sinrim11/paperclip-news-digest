// vercel-react-best-practices §rerender: RSC — no interactivity, pure Tailwind
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
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="font-bold text-sm tabular-nums text-gray-900">
        {value != null ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '–'}
      </div>
      <div className={`inline-flex items-center justify-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums mx-auto ${badgeCls}`}>
        <span>{arrow}</span>
        <span>{change ?? '–'}</span>
      </div>
    </div>
  );
}

export function MarketDashboard({ market }: { market: MarketData }) {
  const tickers = [
    { label: 'KOSPI',    value: market.kospiValue,   change: market.kospiChange,   dir: market.kospiDir },
    { label: 'KOSDAQ',   value: market.kosdaqValue,  change: market.kosdaqChange,  dir: market.kosdaqDir },
    { label: 'USD/KRW',  value: market.usdKrwValue,  change: market.usdKrwChange,  dir: market.usdKrwDir },
    { label: 'WTI',      value: market.wtiValue,     change: market.wtiChange,     dir: market.wtiDir },
    { label: '미국채 10Y', value: market.us10yValue,  change: market.us10yChange,   dir: market.us10yDir },
    { label: 'BTC',      value: market.btcUsdValue,  change: market.btcUsdChange,  dir: market.btcUsdDir },
  ];

  return (
    <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">
        시장 스냅샷
      </h3>
      <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-gray-100">
        {tickers.map((t, i) => (
          <div key={t.label} className={i === 0 ? '' : 'pl-4'}>
            <Ticker {...t} />
          </div>
        ))}
      </div>
    </section>
  );
}
