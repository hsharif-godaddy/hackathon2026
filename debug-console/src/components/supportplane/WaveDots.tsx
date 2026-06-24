'use client';
import React from 'react';

// Material colors matching the wave-loading Lottie (red, blue, green, yellow, orange)
const DEFAULT_COLORS: string[] = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00'];

export function WaveDots({
  size = 7,
  gap = 5,
  colors = DEFAULT_COLORS,
  style,
}: {
  size?: number;
  gap?: number;
  colors?: string[];
  style?: React.CSSProperties;
}) {
  return (
    <span
      role="status"
      aria-label="loading"
      style={{ display: 'inline-flex', alignItems: 'center', gap, ...style }}
    >
      {colors.map((color: string, i: number) => (
        <span
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: color,
            display: 'inline-block',
            animation: 'sp-wave-bounce 1s ease-in-out infinite',
            animationDelay: `${(i * 0.16).toFixed(2)}s`,
          }}
        />
      ))}
    </span>
  );
}
