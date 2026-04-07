import text from '@ux/text'

/**
 * Format large numbers with K/M suffixes for chart display.
 *
 * Compatible with Recharts `tickFormatter` which passes `(value, index)`.
 *
 * @param val - The numeric value to format
 * @param suffix - Optional suffix to append (e.g., "%"). Ignored when a number (Recharts tick index).
 * @returns Formatted string
 */
export function formatChartValue(val: number, suffix?: string | number): string {
  const sfx = typeof suffix === 'string' ? suffix : ''
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return `${Math.round(val)}${sfx}`
}

/* ------------------------------------------------------------------ */
/*  Shared tooltip payload types                                       */
/* ------------------------------------------------------------------ */

export interface SingleTooltipPayload {
  payload: { date: string; [k: string]: unknown }
  value: number
  name?: string
}

export interface MultiTooltipPayload {
  name: string
  value: number
  color: string
  dataKey?: string
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ChartTooltipBaseProps {
  active?: boolean
}

interface SingleSeriesProps extends ChartTooltipBaseProps {
  /** Single-series mode — renders one value row */
  variant?: 'single'
  payload?: SingleTooltipPayload[]
  /** Recharts injects this as the XAxis value — used as the tooltip title */
  label?: string
  /** Descriptive name for the value (e.g. "Page Views", "Clicks"). Won't be overridden by Recharts. */
  valueName?: string
  /** How to derive the title. Defaults to `'date'` (reads `payload[0].payload.date`). */
  titleFrom?: 'date' | 'name'
  /** Value formatter — defaults to `formatChartValue` */
  formatValue?: (val: number) => string
}

interface MultiSeriesProps extends ChartTooltipBaseProps {
  /** Multi-series mode — renders a row per payload entry */
  variant: 'multi'
  payload?: MultiTooltipPayload[]
  label?: string
  /** Show colored dot indicator before each series name */
  showDots?: boolean
  /** Value formatter — defaults to `formatChartValue`. Receives value + dataKey. */
  formatValue?: (val: number, dataKey?: string) => string
}

export type ChartTooltipProps = SingleSeriesProps | MultiSeriesProps

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Shared chart tooltip used by all analytics chart components.
 *
 * Two modes:
 * - `variant="single"` (default) — title + one value row
 * - `variant="multi"` — title + one row per series, optionally with colored dots
 *
 * @example
 * ```tsx
 * // Single-series (default)
 * <Tooltip content={<ChartTooltip label="Page Views" />} />
 *
 * // Multi-series with colored dots
 * <Tooltip content={<ChartTooltip variant="multi" label="Sessions" showDots />} />
 *
 * // Custom value formatter
 * <Tooltip content={<ChartTooltip variant="multi" formatValue={(v, dk) => dk === 'rate' ? `${v}%` : formatChartValue(v)} />} />
 * ```
 */
export function ChartTooltip(props: ChartTooltipProps) {
  const { active, payload } = props

  if (!active || !payload || payload.length === 0) return null

  if (props.variant === 'multi') {
    const { label: tooltipLabel, showDots, formatValue: fmt } = props
    const format = fmt ?? ((v: number) => formatChartValue(v))

    return (
      <div className="bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3">
        <text.p className="!text-sm !font-medium !mb-0">{tooltipLabel}</text.p>
        {(payload as MultiTooltipPayload[]).map((p, i) => (
          <text.p key={i} emphasis="passive" className="!text-sm !mb-0">
            {showDots && <text.span style={{ color: p.color }}>●</text.span>}{showDots && ' '}
            {p.name}: <text.span className="!font-semibold">{format(p.value, p.dataKey)}</text.span>
          </text.p>
        ))}
      </div>
    )
  }

  // Single-series (default)
  const { label: rechartsLabel, valueName, titleFrom = 'date', formatValue: fmt } = props
  const format = fmt ?? ((v: number) => formatChartValue(v))
  const entry = (payload as SingleTooltipPayload[])[0]
  const title = titleFrom === 'name' ? entry.name : (rechartsLabel || entry.payload.date)
  const seriesLabel = valueName || 'Value'

  return (
    <div className="bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3">
      <text.p className="!text-sm !font-medium !mb-0">{title}</text.p>
      <text.p emphasis="passive" className="!text-sm !mb-0">
        {seriesLabel}: <text.span className="!font-semibold">{format(entry.value)}</text.span>
      </text.p>
    </div>
  )
}
