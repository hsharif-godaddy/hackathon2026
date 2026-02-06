'use client'

import { memo, useId } from 'react'

interface LargeCircularGaugeProps {
  /** Current value */
  value: number
  /** Maximum value */
  max: number
  /** Size of the gauge in pixels */
  size?: number
  /** Stroke width in pixels */
  strokeWidth?: number
  /** Additional CSS classes */
  className?: string
}

export default memo(function LargeCircularGauge({
  value,
  max,
  size = 120,
  strokeWidth = 8,
  className = ''
}: LargeCircularGaugeProps) {
  const gradientId = useId()
  const percentage = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0
  const isFull = percentage >= 100
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - percentage / 100)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`transform -rotate-90 ${className}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="var(--color-ai-light)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--color-ai-light)" stopOpacity="1" />
        </linearGradient>
      </defs>
      {/* Background track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        stroke="#11111120"
      />
      {/* Progress arc with gradient or solid color when full */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        stroke={isFull ? 'var(--color-ai-light)' : `url(#${gradientId})`}
        className="transition-all duration-500 ease-out"
      />
    </svg>
  )
})
