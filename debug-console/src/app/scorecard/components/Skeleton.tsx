'use client';

import React from 'react';

const ANIM: string = 'pulse 1.5s ease-in-out infinite';

// ── Primitives ────────────────────────────────────────────────────────────────

export function SkeletonBlock({
  w = '100%', h = '12px', radius = '4px', style,
}: {
  w?: string; h?: string; radius?: string; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      height: h, width: w, borderRadius: radius,
      background: 'var(--sp-s3)', flexShrink: 0,
      animation: ANIM,
      ...style,
    }} />
  );
}

// ── Card-level skeletons ──────────────────────────────────────────────────────

export function SkeletonCard({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{
      backgroundColor: 'var(--sp-s1)', border: '1px solid var(--sp-border)',
      padding: '0.55rem 0.75rem', borderRadius: '10px',
      display: 'flex', flexDirection: 'column', gap: '0.35rem',
      ...style,
    }}>
      <SkeletonBlock w="55%" h="8px" />
      <SkeletonBlock w="42%" h="22px" />
      <SkeletonBlock w="68%" h="8px" />
    </div>
  );
}

// ── Chart placeholder ─────────────────────────────────────────────────────────

export function SkeletonChart({ height = '120px', style }: { height?: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      backgroundColor: 'var(--sp-s1)', border: '1px solid var(--sp-border)',
      borderRadius: '10px', padding: '0.75rem',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      gap: '5px', height,
      ...style,
    }}>
      {[55, 80, 40, 90, 65, 75, 50, 85].map((pct, i) => (
        <SkeletonBlock
          key={i} w={`${pct}%`} h="10px" radius="2px"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

// ── Table row skeleton ────────────────────────────────────────────────────────

export function SkeletonRow({
  cols, style,
}: {
  cols: Array<{ w: string; h?: string }>;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', ...style }}>
      {cols.map((col, i) => (
        <SkeletonBlock key={i} w={col.w} h={col.h ?? '12px'} style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}

// ── Section-level skeleton (n cards in a grid) ────────────────────────────────

export function SkeletonCardGrid({ count = 4, columns = 'repeat(auto-fit, minmax(120px, 1fr))' }: { count?: number; columns?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap: '0.5rem' }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} style={{ animationDelay: `${i * 50}ms` } as React.CSSProperties} />
      ))}
    </div>
  );
}
