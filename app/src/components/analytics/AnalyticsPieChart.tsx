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

import { useTranslations } from '@/hooks/useTranslations'
import { ChartTooltip } from './ChartTooltip'

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsPieChartProps {
  data: ChartDataPoint[]
  label?: string
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
export function AnalyticsPieChart({ data, label = 'Distribution' }: AnalyticsPieChartProps) {
  const chartId = useId().replace(/:/g, '')
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <text.p emphasis="passive" className="!text-center !py-8">{t('builder_analytics_no_data')}</text.p>
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
    const radius = or + 18
    const x = cx + radius * Math.cos(-midAngle * RADIAN)
    const y = cy + radius * Math.sin(-midAngle * RADIAN)
    const text = `${name ?? ''} (${((percent ?? 0) * 100).toFixed(0)}%)`
    return (
      <text x={x} y={y} fill="hsl(var(--foreground))" fontSize={11} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
        {text}
      </text>
    )
  }

  return (
    <div
      data-slot="chart"
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-5 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px]"
    >
      <div className="flex items-center gap-2 mb-3.5">
        <span className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: 'var(--color-chart-pink)', boxShadow: '0 0 6px color-mix(in srgb, var(--color-chart-pink) 25%, transparent)' }} />
        <text.span className="!text-[13px] !font-semibold">{label}</text.span>
      </div>
      <ResponsiveContainer width="100%" height={380} minHeight={250}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={90}
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
          <Tooltip content={<ChartTooltip label={label} titleFrom="name" />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
