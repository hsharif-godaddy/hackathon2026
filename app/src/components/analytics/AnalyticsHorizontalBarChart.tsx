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
import text from '@ux/text'

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
    return <text.p emphasis="passive" className="!text-center !py-8">{t('builder_analytics_no_data')}</text.p>
  }

  return (
    <div
      data-slot="chart"
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-5 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px]"
    >
      <div className="flex items-center gap-2 mb-3.5">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-chart-cyan)', boxShadow: '0 0 6px color-mix(in srgb, var(--color-chart-cyan) 25%, transparent)' }} />
        <text.span className="!text-[13px] !font-semibold">{label}</text.span>
      </div>
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
    </div>
  )
}
