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
export function AnalyticsPieChart({ data, label = 'Distribution', tooltip }: AnalyticsPieChartProps) {
  const chartId = useId().replace(/:/g, '')
  const t = useTranslations()

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border bg-intents-ux-box-backgroundColor p-5">
        <text.span className="!text-[13px] !font-bold !tracking-tight">{label}</text.span>
        <text.p emphasis="passive" className="!text-xs !mb-0">{t('builder_analytics_no_data')}</text.p>
      </div>
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
    <div
      data-slot="chart"
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-2 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px] hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: 'var(--color-chart-pink)', boxShadow: '0 0 8px color-mix(in srgb, var(--color-chart-pink) 30%, transparent)' }} />
        <text.span className="!text-[13px] !font-bold !tracking-tight">{label}</text.span>
        {tooltip && (
          <InfoTooltip
            content={tooltip}
            iconClassName="size-[13px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            contentClassName="p-1 max-w-[240px] text-xs"
          />
        )}
      </div>
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
    </div>
  )
}
