'use client';

import React from 'react';

import { ScorecardHelpBadge } from './ScorecardHelpBadge';
import type { ScorecardHelpInfo } from './ScorecardHelpBadge';

interface Props {
  label:        string;
  value:        number | string | null;
  sublabel?:    string;
  description?: string;
  accent?:      'default' | 'premium' | 'info';
  help?:        ScorecardHelpInfo;
  onClick?:     () => void;
  expanded?:    boolean;
}

const ACCENT_COLOR: Record<string, string> = {
  default: 'var(--sp-accent)',
  premium: 'var(--sp-violet)',
  info:    'var(--sp-indigo)',
};

export function StatCard({ label, value, sublabel, description, accent = 'default', help, onClick, expanded }: Props) {
  const isClickable: boolean = onClick !== undefined;
  const Wrapper              = isClickable ? 'button' : 'div';
  const color: string        = ACCENT_COLOR[accent] ?? ACCENT_COLOR.default;

  return (
    <Wrapper
      type={isClickable ? 'button' : undefined}
      style={{
        backgroundColor: 'var(--sp-s1)',
        border: expanded ? '1px solid var(--sp-accent)' : '1px solid var(--sp-border)',
        padding: '0.55rem 0.75rem',
        borderRadius: '10px',
        boxShadow: expanded ? '0 0 0 2px var(--sp-accent-ring)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        width: '100%',
        textAlign: 'left',
      }}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
        <div style={{ fontSize: '0.53rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
          {help && <ScorecardHelpBadge info={help} color={color} />}
          {isClickable && <span style={{ fontSize: '0.5rem', color: expanded ? 'var(--sp-accent)' : 'var(--sp-txm)' }}>{expanded ? '▲' : '▼'}</span>}
        </div>
      </div>
      <div style={{ fontSize: '1rem', fontWeight: 800, color, fontFamily: 'monospace', marginTop: '0.1rem', lineHeight: 1 }}>
        {value !== null && value !== undefined ? (typeof value === 'number' ? value.toLocaleString() : value) : '—'}
      </div>
      {sublabel && <div style={{ fontSize: '0.5rem', color: 'var(--sp-tx2)', fontFamily: 'monospace', marginTop: '0.03rem' }}>{sublabel}</div>}
      {description && <div style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)', marginTop: '0.05rem', lineHeight: 1.3 }}>{description}</div>}
    </Wrapper>
  );
}
