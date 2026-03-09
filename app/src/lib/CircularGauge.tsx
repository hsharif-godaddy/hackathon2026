'use client'

import { memo } from 'react'

interface CircularGaugeProps {
  /** Current value (0-100) */
  value: number
  /** Size of the gauge in pixels */
  size?: number
  /** Stroke width in pixels */
  strokeWidth?: number
  /** Additional CSS classes */
  className?: string
}

const GAUGE_FILL_COLOR = 'var(--color-ai, #613EA3)'
const GAUGE_TRACK_COLOR = 'var(--color-gauge-track, #D9D9D9)'

export default memo(function CircularGauge({
  value,
  size = 20,
  strokeWidth = 3,
  className = ''
}: CircularGaugeProps) {
  const normalizedValue = Math.min(Math.max(value, 0), 100)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - normalizedValue / 100)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`transform -rotate-90 ${className}`}
    >
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        stroke={GAUGE_TRACK_COLOR}
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        stroke={GAUGE_FILL_COLOR}
        className="transition-all duration-300"
      />
    </svg>
  )
})
