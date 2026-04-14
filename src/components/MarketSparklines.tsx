// vercel-react-best-practices §bundle-dynamic-imports: recharts split into lazy chunk via next/dynamic — excluded from main bundle
'use client';
import dynamic from 'next/dynamic';
import type { SparklineChartProps } from './SparklineChart';

const SparklineChart = dynamic<SparklineChartProps>(
  () => import('./SparklineChart').then((m) => m.SparklineChart),
  {
    ssr: false,
    loading: () => <div className="h-14 rounded bg-gray-100 animate-pulse" />,
  },
);

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
  /** Brand color for the sparkline stroke — neutral, not direction-based */
  color: string;
  unit: string;
}

const SPARKS: SparkConfig[] = [
  { key: 'kospi',  label: 'KOSPI',   color: '#3b82f6', unit: '' },
  { key: 'kosdaq', label: 'KOSDAQ',  color: '#10b981', unit: '' },
  { key: 'usdKrw', label: 'USD/KRW', color: '#f59e0b', unit: '₩' },
  { key: 'wti',    label: 'WTI',     color: '#8b5cf6', unit: '$' },
];

function weekPct(values: number[]): number {
  if (values.length < 2 || !values[0]) return 0;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}

export function MarketSparklines({ data }: { data: MarketDayData[] }) {
  if (!data.length) return null;

  return (
    <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">
        주간 마켓 동향
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {SPARKS.map(({ key, label, color, unit }) => {
          const series = data
            .map((d) => ({ date: d.date, v: d[key] as number | undefined }))
            .filter((d): d is { date: string; v: number } => d.v != null && d.v > 0);

          if (!series.length) return null;

          const latest = series[series.length - 1].v;
          const change = weekPct(series.map((s) => s.v));
          // Korean market convention: up = red, down = blue (matches MarketDashboard Ticker)
          const up = change > 0;
          const flat = change === 0;
          const arrow = flat ? '–' : up ? '▲' : '▼';
          const badgeCls = flat
            ? 'bg-gray-50 text-gray-400 border border-gray-100'
            : up
            ? 'bg-red-50 text-red-600 border border-red-200'
            : 'bg-blue-50 text-blue-600 border border-blue-200';

          return (
            <div
              key={key}
              className="rounded-lg border border-gray-100 bg-gray-50/40 p-3 transition-shadow duration-150 hover:shadow-md hover:bg-white"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                  {label}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${badgeCls}`}
                >
                  <span>{arrow}</span>
                  <span>{Math.abs(change).toFixed(1)}%</span>
                </span>
              </div>
              <div className="text-sm font-bold text-gray-900 mb-2 tabular-nums">
                {unit}
                {latest.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}
              </div>
              <div className="h-14">
                <SparklineChart
                  series={series}
                  color={color}
                  unit={unit}
                  label={label}
                  gradientId={`spark-grad-${key}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
