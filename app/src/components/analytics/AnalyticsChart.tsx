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

import { AnalyticsCard, AnalyticsTextLockup } from '@/components/analytics/AnalyticsCard'
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
  /** When true and data is empty, render a zero chart instead of "no data" */
  fetched?: boolean
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
export function AnalyticsChart({ data, label, embedded, fetched = false }: AnalyticsChartProps) {
  const t = useTranslations()
  const gradientId = useId().replace(/:/g, '')
  const chartLabel = label ?? t('builder_analytics_chart_pageviews')
  const chartData = data?.length ? data : (fetched ? [{ date: '—', value: 0 }] : [])

  if (!chartData.length) {
    if (embedded) {
      return (
        <AnalyticsTextLockup
          title={chartLabel}
          description={t('builder_analytics_no_data')}
        />
      )
    }
    return (
      <AnalyticsCard
        title={chartLabel}
        description={t('builder_analytics_no_data')}
      />
    )
  }

  const chartContent = (
    <ResponsiveContainer width="100%" height={260} minHeight={200} className="px-2">
      <AreaChart
        data={chartData}
        margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
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
          height={20}
          stroke="hsl(var(--muted-foreground))"
          tick={{ className: 'text-xs tabular-nums' }}
          tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis
          width="auto"
          stroke="hsl(var(--muted-foreground))"
          tick={{ className: 'text-xs tabular-nums' }}
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
    <AnalyticsCard data-slot="chart" title={chartLabel} className="min-h-[250px]">
      {chartContent}
    </AnalyticsCard>
  )
}
