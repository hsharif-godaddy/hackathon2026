import { useId } from 'react'
import {
  Area,
  AreaChart,
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

export interface MultiAreaDataPoint {
  date: string
  [key: string]: string | number
}

interface SeriesConfig {
  key: string
  name: string
  color: string
  strokeDasharray?: string
}

interface AnalyticsMultiAreaChartProps {
  data: MultiAreaDataPoint[]
  label?: string
  series: SeriesConfig[]
  stacked?: boolean
  embedded?: boolean
}

/**
 * Multi-series area chart
 *
 * Used for BrowserArea (sessions + unique_visitors dual area),
 * DailyTrendByPage (stacked area per page path).
 * Matching index2.html area chart patterns.
 */
export function AnalyticsMultiAreaChart({
  data,
  label = 'Value',
  series,
  stacked = false,
  embedded = false
}: AnalyticsMultiAreaChartProps) {
  const chartId = useId().replace(/:/g, '')
  const t = useTranslations()

  if (!data || data.length === 0) {
    return <text.p emphasis="passive" className="!text-center !py-8">{t('builder_analytics_no_data')}</text.p>
  }

  const chartContent = (
    <ResponsiveContainer width="100%" height={260} minHeight={200}>
      <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={`grad-${chartId}-${i}`} id={`grad-${chartId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-border))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip variant="multi" showDots />} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stackId={stacked ? 'stack' : undefined}
              stroke={s.color}
              strokeWidth={stacked ? 2 : (i === 0 ? 3 : 2)}
              fill={`url(#grad-${chartId}-${i})`}
              strokeDasharray={s.strokeDasharray}
              dot={{ fill: s.color, r: i === 0 ? 4 : 3, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
              activeDot={{ r: 7, stroke: s.color, strokeWidth: 2, fill: 'hsl(var(--background))' }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
  )

  if (embedded) return chartContent

  return (
    <div
      data-slot="chart"
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-2 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px]"
    >
      <div className="flex items-center gap-2 mb-3.5">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-ai-light)', boxShadow: '0 0 6px color-mix(in srgb, var(--color-ai-light) 25%, transparent)' }} />
        <text.span className="!text-[13px] !font-semibold">{label}</text.span>
      </div>
      {chartContent}
    </div>
  )
}
