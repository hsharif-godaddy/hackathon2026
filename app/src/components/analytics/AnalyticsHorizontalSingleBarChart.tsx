import { useId } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { ChartTooltip, formatChartValue } from './ChartTooltip'

interface ChartDataPoint {
  date: string
  value: number
}

interface AnalyticsHorizontalSingleBarChartProps {
  data: ChartDataPoint[]
  label?: string
  /** Optional suffix for the value display (e.g. "%" for percentages) */
  suffix?: string
  /** Bar color, defaults to brand purple */
  color?: string
  /** Max Y-axis label width */
  labelWidth?: number
}

const DEFAULT_COLOR = 'var(--color-ai)'
const COLORS = ['var(--color-ai)', 'var(--color-ai-light)', 'var(--color-chart-blue)', 'var(--color-chart-green)', 'var(--color-chart-amber)', 'var(--color-chart-pink)', 'var(--color-chart-cyan)', 'var(--color-chart-violet)']

/**
 * Single-series horizontal bar chart for categorical data.
 *
 * Ideal when the category labels are text strings (page paths, country names)
 * that need horizontal space to remain readable.
 *
 * @param data - Array of `{ date, value }` where `date` is the category label
 * @param label - Chart title
 * @param suffix - Optional value suffix like "%"
 * @param color - Bar color override
 * @param labelWidth - Width reserved for Y-axis labels (default 120)
 */
export function AnalyticsHorizontalSingleBarChart({
  data,
  label = 'Value',
  suffix = '',
  color,
  labelWidth = 120,
}: AnalyticsHorizontalSingleBarChartProps) {
  const chartId = useId().replace(/:/g, '')
  const t = useTranslations()

  if (!data || data.length === 0) {
    return <text.p emphasis="passive" className="!text-center !py-8">{t('builder_analytics_no_data')}</text.p>
  }

  const formatValue = (val: number): string => formatChartValue(val, suffix)

  // Truncate long labels for the Y-axis
  const truncateLabel = (text: string, maxLen = 18): string => {
    if (text.length <= maxLen) return text
    return `${text.slice(0, maxLen)}…`
  }

  const dynamicHeight = Math.max(220, data.length * 44 + 60)
  const useMultiColor = !color

  return (
    <div
      data-slot="chart"
      className="flex flex-col w-full rounded-lg border bg-intents-ux-box-backgroundColor p-5 shadow-sm transition-all duration-200 ease-out hover:shadow-md hover:border-light-purple-solid hover:-translate-y-px min-h-[220px]"
    >
      <div className="flex items-center gap-2 mb-3.5">
        <span
          className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
          style={{ background: color ?? DEFAULT_COLOR, boxShadow: `0 0 6px color-mix(in srgb, ${color ?? DEFAULT_COLOR} 25%, transparent)` }}
        />
        <text.span className="!text-[13px] !font-semibold">{label}</text.span>
      </div>
      <ResponsiveContainer width="100%" height={dynamicHeight}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 40, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-border))" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            tickFormatter={formatValue}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="date"
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
            tickFormatter={(v: string) => truncateLabel(v)}
            width={labelWidth}
          />
          <Tooltip content={<ChartTooltip valueName={label} formatValue={formatValue} />} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
            {data.map((_, index) => (
              <Cell
                key={`cell-${chartId}-${index}`}
                fill={useMultiColor ? COLORS[index % COLORS.length] : (color ?? DEFAULT_COLOR)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
