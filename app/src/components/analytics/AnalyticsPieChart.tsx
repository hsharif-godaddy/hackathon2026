import { useId } from 'react'
import type { PieLabelRenderProps } from 'recharts'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip
} from 'recharts'
import text from '@ux/text'

import { AnalyticsCard } from '@/components/analytics/AnalyticsCard'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import { useTranslations } from '@/hooks/useTranslations'
import { ChartTooltip } from './ChartTooltip'

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsPieChartProps {
  data: ChartDataPoint[]
  label?: string
  /** Optional tooltip shown on info icon next to title */
  tooltip?: string
  fetched?: boolean
}

const COLORS = ['var(--color-ai)', 'var(--color-ai-light)', 'var(--color-chart-blue)', 'var(--color-chart-green)', 'var(--color-chart-amber)', 'var(--color-chart-pink)', 'var(--color-chart-cyan)', 'var(--color-chart-violet)']

/**
 * Pie/Donut chart component for displaying analytics distribution
 *
 * Renders a donut chart with colored segments.
 * Uses Recharts library for maintainable and feature-rich charting.
 *
 * @param data - Array of data points with date and value
 * @param label - Chart label
 */
export function AnalyticsPieChart({ data, label = 'Distribution', tooltip, fetched = false }: AnalyticsPieChartProps) {
  const chartId = useId().replace(/:/g, '')
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <AnalyticsCard
        title={<>
          {label}
          {tooltip && (<InfoTooltip content={tooltip}/>)}
        </>}
        description={fetched ? '0' : t('builder_analytics_no_data')}
      />
    )
  }

  // Convert time-series data to pie segments
  const pieData = data.map(d => ({
    name: d.date,
    value: d.value
  }))

  const RADIAN = Math.PI / 180
  const renderLabel = (props: PieLabelRenderProps) => {
    const { cx: cxProp, cy: cyProp, midAngle: midAngleProp, outerRadius: orProp, name, percent } = props
    const cx = Number(cxProp ?? 0)
    const cy = Number(cyProp ?? 0)
    const midAngle = Number(midAngleProp ?? 0)
    const or = Number(orProp ?? 0)
    const radius = or + 10
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    const pct = `${((percent ?? 0) * 100).toFixed(0)}%`
    const truncatedName = name && String(name).length > 10 ? `${String(name).slice(0, 10)}…` : (name ?? '')
    const labelText = truncatedName ? `${truncatedName} ${pct}` : pct
    return (
      <text x={x} y={y} fill="hsl(var(--foreground))" fontSize={10} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
        {labelText}
      </text>
    )
  }

  return (
    <AnalyticsCard
      data-slot="chart"
      title={<>
        {label}
        {tooltip && (<InfoTooltip content={tooltip}/>)}
      </>}
    >
      <ResponsiveContainer width="100%" height={200} minHeight={140}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius="30%"
            outerRadius="50%"
            paddingAngle={3}
            dataKey="value"
            nameKey="name"
            label={renderLabel}
            labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          >
            {pieData.map((_, index) => (
              <Cell
                key={`cell-${chartId}-${index}`}
                fill={COLORS[index % COLORS.length]}
                stroke="hsl(var(--background))"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip valueName={label} titleFrom="name" />} />
        </PieChart>
      </ResponsiveContainer>
    </AnalyticsCard>
  )
}
