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

export interface StackedBarDataPoint {
  date: string
  [key: string]: string | number
}

interface SeriesConfig {
  key: string
  name: string
  color: string
}

interface AnalyticsStackedBarChartProps {
  data: StackedBarDataPoint[]
  label?: string
  series: SeriesConfig[]
}

/**
 * Stacked bar chart with multiple series
 *
 * Used for NewVsReturning (new + returning stacked), DeviceMixOverTime (laptop/tablet/mobile)
 * matching index2.html stacked bar patterns.
 */
export function AnalyticsStackedBarChart({
  data,
  label = 'Value',
  series
}: AnalyticsStackedBarChartProps) {
  const t = useTranslations()

  if (!data || data.length === 0) {
    return <text.p emphasis="passive" className="!text-center !py-8">{t('builder_analytics_no_data')}</text.p>
  }

  return (
    <div
      data-slot="chart"
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-2 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px]"
    >
      <div className="flex items-center gap-2 mb-3.5">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-chart-green)', boxShadow: '0 0 6px color-mix(in srgb, var(--color-chart-green) 25%, transparent)' }} />
        <text.span className="!text-[13px] !font-semibold">{label}</text.span>
      </div>
      <ResponsiveContainer width="100%" height={350} minHeight={250}>
        <BarChart data={data} margin={{ top: 10, right: 30, bottom: 20, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-border))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip variant="multi" showDots />} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="stack"
              fill={s.color}
              maxBarSize={55}
              radius={i === series.length - 1 ? [6, 6, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
