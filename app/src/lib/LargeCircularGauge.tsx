"use client";

import { memo, useId } from "react";

interface LargeCircularGaugeProps {
  /** Current value */
  value: number;
  /** Maximum value */
  max: number;
  /** Size of the gauge in pixels */
  size?: number;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Additional CSS classes */
  className?: string;
}

export default memo(function LargeCircularGauge({
  value,
  max,
  size = 120,
  strokeWidth = 8,
  className = "",
}: LargeCircularGaugeProps) {
  const gradientId = useId();
  const percentage =
    max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
  const isFull = percentage >= 100;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percentage / 100);
  const cx = size / 2;
  const cy = size / 2;
  //Chord from arc start (SVG circle path begins at 3 o'clock, clockwise) to arc end so
  //stops align with visible progress; matches horizontal bar endpoints via same CSS vars.
  const arcSpanRad = (2 * Math.PI * percentage) / 100;
  const minSpanRad = 0.03;
  const gradientSpanRad =
    isFull || percentage <= 0 ? minSpanRad : Math.max(arcSpanRad, minSpanRad);
  const gradientX1 = cx + radius;
  const gradientY1 = cy;
  const gradientX2 = cx + radius * Math.cos(gradientSpanRad);
  const gradientY2 = cy + radius * Math.sin(gradientSpanRad);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`transform -rotate-90 ${className}`}
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={gradientX1}
          y1={gradientY1}
          x2={gradientX2}
          y2={gradientY2}
        >
          <stop offset="0%" stopColor="var(--credit-meter-fill-start)" />
          <stop offset="100%" stopColor="var(--color-ai-light)" />
        </linearGradient>
      </defs>
      {/* Background track */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        stroke="#11111120"
      />
      {/* Progress arc with gradient or solid color when full */}
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        stroke={isFull ? "var(--color-ai-light)" : `url(#${gradientId})`}
        className="transition-all duration-500 ease-out"
      />
    </svg>
  );
});
