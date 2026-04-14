// vercel-react-best-practices §bundle-dynamic-imports: recharts rendering isolated here so next/dynamic can split it from the main chunk
'use client';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

export interface SparklineChartProps {
  series: { date: string; v: number }[];
  color: string;
  unit: string;
  label: string;
  gradientId: string;
}

export function SparklineChart({ series, color, unit, label, gradientId }: SparklineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: '11px',
            padding: '3px 8px',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
          formatter={(val) => [
            `${unit}${Number(val)?.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}`,
            label,
          ]}
          labelFormatter={(l) => l}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
