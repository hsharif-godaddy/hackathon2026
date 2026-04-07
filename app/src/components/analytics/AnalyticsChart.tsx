import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { ChartTooltip, formatChartValue } from './ChartTooltip'

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsChartProps {
  data: ChartDataPoint[]
  label?: string
  embedded?: boolean
}

/**
 * Area chart component for displaying analytics trends over time
 *
 * Renders an area chart with gradient fill showing visitor/pageview trends
 * with proper axis labels and grid lines. Supports responsive sizing and data updates.
 * Uses Recharts library for maintainable and feature-rich charting.
 *
 * @param data - Array of data points with date and value
 */
export function AnalyticsChart({ data, label, embedded }: AnalyticsChartProps) {
  const t = useTranslations()
  const gradientId = useId().replace(/:/g, '')
  const chartLabel = label ?? t('builder_analytics_chart_pageviews')

  if (!data || data.length === 0) {
    return (
      <text.p emphasis="passive" className="!text-center !py-8">{t('builder_analytics_no_data')}</text.p>
    )
  }

  const chartContent = (
    <ResponsiveContainer width="100%" height={350} minHeight={250}>
      <AreaChart
          data={data}
          margin={{
            top: 20,
            right: 40,
            bottom: 40,
            left: 50
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--muted-border))"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
            tickFormatter={formatChartValue}
          />
          <Tooltip content={<ChartTooltip valueName={chartLabel} />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-ai)"
            strokeWidth={3}
            fill={`url(#${gradientId})`}
            fillOpacity={0.6}
            dot={{ fill: 'var(--color-ai)', r: 5, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
            activeDot={{ r: 7, stroke: 'var(--color-ai)', strokeWidth: 2, fill: 'hsl(var(--background))' }}
          />
        </AreaChart>
      </ResponsiveContainer>
  )

  if (embedded) return chartContent

  return (
    <div
      data-slot="chart"
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-5 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px]"
    >
      <div className="flex items-center gap-2 mb-3.5">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-ai)', boxShadow: '0 0 6px var(--color-ai-glow)' }} />
        <text.span className="!text-[13px] !font-semibold">{chartLabel}</text.span>
      </div>
      {chartContent}
    </div>
  )
}

