'use client';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

export interface MarketDayData {
  date: string;
  kospi?: number;
  kosdaq?: number;
  usdKrw?: number;
  wti?: number;
}

interface SparkConfig {
  key: keyof Omit<MarketDayData, 'date'>;
  label: string;
  color: string;
  unit: string;
}

const SPARKS: SparkConfig[] = [
  { key: 'kospi',  label: 'KOSPI',   color: '#3b82f6', unit: '' },
  { key: 'kosdaq', label: 'KOSDAQ',  color: '#10b981', unit: '' },
  { key: 'usdKrw', label: 'USD/KRW', color: '#f59e0b', unit: '₩' },
  { key: 'wti',    label: 'WTI',     color: '#ef4444', unit: '$' },
];

function weekPct(values: number[]): number {
  if (values.length < 2 || !values[0]) return 0;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}

export function MarketSparklines({ data }: { data: MarketDayData[] }) {
  if (!data.length) return null;

  return (
    <section>
      <h3 className="font-bold text-lg mb-4">📊 주간 마켓 동향</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {SPARKS.map(({ key, label, color, unit }) => {
          const series = data
            .map((d) => ({ date: d.date, v: d[key] as number | undefined }))
            .filter((d): d is { date: string; v: number } => d.v != null && d.v > 0);

          if (!series.length) return null;

          const latest = series[series.length - 1].v;
          const change = weekPct(series.map((s) => s.v));
          const up = change >= 0;

          return (
            <div key={key} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {label}
                </span>
                <span className={`text-xs font-bold ${up ? 'text-green-600' : 'text-red-500'}`}>
                  {up ? '+' : ''}
                  {change.toFixed(1)}%
                </span>
              </div>
              <div className="text-sm font-bold text-gray-800 mb-2 tabular-nums">
                {unit}
                {latest.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}
              </div>
              <div className="h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={color}
                      strokeWidth={1.5}
                      fill={`url(#grad-${key})`}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: '11px', padding: '2px 6px' }}
                      formatter={(val) => [
                        `${unit}${Number(val)?.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}`,
                        label,
                      ]}
                      labelFormatter={(l) => l}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
