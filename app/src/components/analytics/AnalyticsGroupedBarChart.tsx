import { useId } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

interface AnalyticsGroupedBarChartProps {
  data: DualSeriesDataPoint[]
  label?: string
  series1Name?: string
  series2Name?: string
  series1Color?: string
  series2Color?: string
  /** Use unique color per bar in series1 instead of flat color */
  colorPerBar?: boolean
}

const COLORS = ['var(--color-ai)', 'var(--color-ai-light)', 'var(--color-chart-blue)', 'var(--color-chart-green)', 'var(--color-chart-amber)', 'var(--color-chart-pink)', 'var(--color-chart-cyan)', 'var(--color-chart-violet)']

/**
 * Grouped bar chart with dual series side-by-side
 *
 * Used for EntryExitBar, BounceBar, ElementSectionBar, CTATrend, BusiestHourBar
 * matching index2.html grouped bar patterns.
 */
export function AnalyticsGroupedBarChart({
  data,
  label = 'Value',
  series1Name = 'Primary',
  series2Name = 'Secondary',
  series1Color = 'var(--color-ai)',
  series2Color = 'var(--color-ai-muted)',
  colorPerBar = false
}: AnalyticsGroupedBarChartProps) {
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
        <BarChart data={data} margin={{ top: 10, right: 30, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-border))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
            interval={0}
            angle={data.length > 5 ? -20 : 0}
            textAnchor={data.length > 5 ? 'end' : 'middle'}
            height={data.length > 5 ? 60 : 30}
          />
          <YAxis
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            allowDecimals={false}
          />
          <Tooltip content={<ChartTooltip variant="multi" />} />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="value" name={series1Name} radius={[6, 6, 0, 0]} maxBarSize={42}>
            {colorPerBar
              ? data.map((_, i) => <Cell key={`c1-${chartId}-${i}`} fill={COLORS[i % COLORS.length]} />)
              : data.map((_, i) => <Cell key={`c1-${chartId}-${i}`} fill={series1Color} />)
            }
          </Bar>
          <Bar
            dataKey="value2"
            name={series2Name}
            fill={series2Color}
            radius={[6, 6, 0, 0]}
            maxBarSize={42}
            opacity={0.6}
          />
        </BarChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  )
}
