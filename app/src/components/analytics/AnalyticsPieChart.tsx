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
import { Tooltip as InfoTooltip, TooltipContent, TooltipTrigger } from '@/lib/shadcn/tooltip'
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
    const radius = or + 14
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
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-2 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[250px] hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: 'var(--color-chart-pink)', boxShadow: '0 0 8px color-mix(in srgb, var(--color-chart-pink) 30%, transparent)' }} />
        <text.span className="!text-[13px] !font-bold !tracking-tight">{label}</text.span>
        {tooltip && (
          <InfoTooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="More information" className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px] text-xs">
              {tooltip}
            </TooltipContent>
          </InfoTooltip>
        )}
      </div>
      <ResponsiveContainer width="100%" height={220} minHeight={160}>
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
