import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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

export interface ComposedDataPoint {
  date: string
  value: number
  value2?: number
  rate?: number
}

interface AnalyticsComposedChartProps {
  data: ChartDataPoint[] | ComposedDataPoint[]
  label?: string
  /** Name for the primary bar series */
  series1Name?: string
  /** Name for the optional second bar series */
  series2Name?: string
  /** Name for the line series */
  lineName?: string
}

/**
 * Composed chart (Bar + Line) for displaying analytics with dual axes
 *
 * Renders bars for volume and a line for rate/percentage.
 * Ideal for exit rate, bounce rate, or any metric with absolute + ratio values.
 *
 * @param data - Array of data points with date and value
 * @param label - Chart label
 */
export function AnalyticsComposedChart({
  data,
  label = 'Value',
  series1Name,
  series2Name = 'Sessions',
  lineName = 'Rate %'
}: AnalyticsComposedChartProps) {
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <AnalyticsCard
        title={label}
        description={t('builder_analytics_no_data')}
      />
    )
  }

  const formatValue = (val: number, dataKey?: string): string =>
    dataKey === 'rate' ? `${val}%` : formatChartValue(val)

  const barLabel = series1Name ?? label

  // Check if data already has rate/value2 fields (ComposedDataPoint)
  const firstPoint = data[0] as ComposedDataPoint | undefined
  const hasRate = firstPoint != null && 'rate' in firstPoint
  const hasValue2 = firstPoint != null && 'value2' in firstPoint

  // Derive synthetic "rate" from value if not provided
  const maxValue = Math.max(...data.map(d => d.value), 1)
  const composedData = data.map(d => {
    const point = d as ComposedDataPoint
    return {
      ...d,
      value2: point.value2 ?? 0,
      rate: point.rate ?? Number(((d.value / maxValue) * 100).toFixed(1))
    }
  })

  return (
    <AnalyticsCard data-slot="chart" title={label} className="min-h-[250px]">
      <ResponsiveContainer width="100%" height={350} minHeight={250}>
        <ComposedChart
          data={composedData}
          margin={{ top: 20, right: 50, bottom: 40, left: 50 }}
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
            yAxisId="left"
            stroke="hsl(var(--muted-foreground))"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
            tickFormatter={formatChartValue}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: 'var(--color-chart-amber)', fontSize: 12 }}
            unit="%"
            domain={[0, 100]}
          />
          <Tooltip content={<ChartTooltip variant="multi" formatValue={formatValue} />} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar
            yAxisId="left"
            dataKey="value"
            name={barLabel}
            fill="var(--color-ai)"
            radius={[6, 6, 0, 0]}
            maxBarSize={45}
            opacity={0.85}
          />
          {hasValue2 && (
            <Bar
              yAxisId="left"
              dataKey="value2"
              name={series2Name}
              fill="var(--color-ai-muted)"
              radius={[6, 6, 0, 0]}
              maxBarSize={45}
              opacity={0.6}
            />
          )}
          <Line
            yAxisId="right"
            dataKey="rate"
            name={lineName}
            stroke={hasRate ? 'var(--color-chart-green)' : 'var(--color-chart-amber)'}
            strokeWidth={3}
            dot={{ fill: hasRate ? 'var(--color-chart-green)' : 'var(--color-chart-amber)', r: 5, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
            activeDot={{ r: 7, stroke: hasRate ? 'var(--color-chart-green)' : 'var(--color-chart-amber)', strokeWidth: 2, fill: 'hsl(var(--background))' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  )
}
