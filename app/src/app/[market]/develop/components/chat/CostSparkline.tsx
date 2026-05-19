'use client'

import { type ReactElement } from 'react'

interface CostSparklineProps {
  values: number[]
  width?: number
  height?: number
  /** Override the auto-scale y-axis max. Useful for percentages where 1.0 is the absolute ceiling. */
  maxOverride?: number
  /** Format function for the bar's hover tooltip. Defaults to a 4-decimal USD string. */
  formatValue?: (value: number) => string
  /** Accessible label for the SVG. */
  ariaLabel?: string
}

const defaultFormatValue = (v: number): string => `$${v.toFixed(4)}`

export default function CostSparkline({
  values,
  width = 240,
  height = 40,
  maxOverride,
  formatValue = defaultFormatValue,
  ariaLabel = 'cost per prompt',
}: CostSparklineProps): ReactElement {
  if (values.length === 0) {
    return <div className="text-xs text-muted-foreground">no data yet</div>
  }

  const max = maxOverride ?? Math.max(...values, 0.0000001)
  const barGap = 2
  const barWidth = Math.max(1, (width - barGap * (values.length - 1)) / values.length)

  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel}>
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * height)
        const x = i * (barWidth + barGap)
        const y = height - h
        return (
          <rect
            key={i}
            data-testid="cost-sparkline-bar"
            x={x}
            y={y}
            width={barWidth}
            height={h}
            className="fill-current text-primary"
          >
            <title>{formatValue(v)}</title>
          </rect>
        )
      })}
    </svg>
  )
}
