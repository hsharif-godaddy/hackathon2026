'use client';


import { ScorecardHelpBadge } from './ScorecardHelpBadge';
import type { ScorecardHelpInfo } from './ScorecardHelpBadge';

import type { MetricValue } from '../types';

interface Props {
  label:          string;
  metric:         MetricValue | null;
  description?:   string;
  lowerIsBetter?: boolean;
  green?:         number;
  amber?:         number;
  help?:          ScorecardHelpInfo;
}

function healthColor(rate: number | null, lowerIsBetter: boolean, green: number, amber: number): string {
  if (rate === null) return 'var(--sp-txm)';
  if (lowerIsBetter) return rate <= green ? 'var(--sp-success)' : rate <= amber ? 'var(--sp-warning)' : 'var(--sp-danger)';
  return rate >= green ? 'var(--sp-success)' : rate >= amber ? 'var(--sp-warning)' : 'var(--sp-danger)';
}

export function MetricCard({ label, metric, description, lowerIsBetter = false, green = 70, amber = 50, help }: Props) {
  const rate: number | null = metric?.rate ?? null;
  const color: string       = healthColor(rate, lowerIsBetter, green, amber);

  return (
    <div style={{
      backgroundColor: 'var(--sp-s1)',
      border: '1px solid var(--sp-border)',
      padding: '0.55rem 0.75rem',
      borderRadius: '10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
        <div style={{ fontSize: '0.53rem', fontWeight: 600, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2 }}>{label}</div>
        {help && <ScorecardHelpBadge info={help} color={color} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.3rem', marginTop: '0.1rem' }}>
        <span style={{ fontSize: '1rem', fontWeight: 800, color, fontFamily: 'monospace', lineHeight: 1 }}>
          {rate !== null ? `${rate}%` : '—'}
        </span>
        {metric && metric.denominator > 0 && (
          <span style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)', fontFamily: 'monospace' }}>{metric.numerator.toLocaleString()}/{metric.denominator.toLocaleString()}</span>
        )}
      </div>
      {description && <div style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)', marginTop: '0.05rem', lineHeight: 1.3 }}>{description}</div>}
    </div>
  );
}
