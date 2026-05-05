import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { useTranslations } from '@/hooks/useTranslations'
import { ChartTooltip } from './ChartTooltip'

export interface DualSeriesDataPoint {
  date: string
  value: number
  value2: number
}

interface AnalyticsHorizontalBarChartProps {
  data: DualSeriesDataPoint[]
  label?: string
  series1Name?: string
  series2Name?: string
  series1Color?: string
  series2Color?: string
}

/**
 * Horizontal bar chart with dual series
 *
 * Used for Top Referrers, Top CTA Labels — matching index2.html
 * layout="vertical" with two horizontal bar series side by side.
 */
export function AnalyticsHorizontalBarChart({
  data,
  label = 'Value',
  series1Name = 'Primary',
  series2Name = 'Secondary',
  series1Color = 'var(--color-ai)',
  series2Color = 'var(--color-ai-muted)'
}: AnalyticsHorizontalBarChartProps) {
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <AnalyticsCard
        title={label}
        description={t('builder_analytics_no_data')}
      />
    )
  }

  return (
    <AnalyticsCard data-slot="chart" title={label} className="min-h-[250px]">
      <ResponsiveContainer width="100%" height={Math.max(250, data.length * 50 + 60)}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-border))" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="date"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            width={180}
          />
          <Tooltip content={<ChartTooltip variant="multi" />} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="value" name={series1Name} fill={series1Color} radius={[0, 6, 6, 0]} maxBarSize={28} />
          <Bar dataKey="value2" name={series2Name} fill={series2Color} radius={[0, 6, 6, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  )
}
