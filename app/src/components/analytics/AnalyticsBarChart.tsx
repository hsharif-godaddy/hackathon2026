import { useId } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { useTranslations } from '@/hooks/useTranslations'
import { ChartTooltip, formatChartValue } from './ChartTooltip'

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsBarChartProps {
  data: ChartDataPoint[]
  label?: string
}

const COLORS = ['var(--color-ai)', 'var(--color-ai-light)', 'var(--color-chart-blue)', 'var(--color-chart-green)', 'var(--color-chart-amber)', 'var(--color-chart-pink)', 'var(--color-chart-cyan)', 'var(--color-chart-violet)']

/**
 * Bar chart component for displaying analytics data
 *
 * Renders a vertical bar chart with colored bars.
 * Uses Recharts library for maintainable and feature-rich charting.
 *
 * @param data - Array of data points with date and value
 * @param label - Chart label
 */
export function AnalyticsBarChart({ data, label = 'Value' }: AnalyticsBarChartProps) {
  const chartId = useId().replace(/:/g, '')
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
      <ResponsiveContainer width="100%" height={350} minHeight={250}>
        <BarChart
          data={data}
          margin={{ top: 20, right: 40, bottom: 40, left: 50 }}
        >
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
          <Tooltip content={<ChartTooltip valueName={label} />} />
          <Bar
            dataKey="value"
            radius={[6, 6, 0, 0]}
            maxBarSize={55}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${chartId}-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  )
}
