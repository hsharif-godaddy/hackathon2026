'use client';

import React, { useState } from 'react';

import type { FunnelStep, ScorecardChartSize } from '../types';
import { FunnelStepDetail } from './DetailPanels';

interface Props {
  steps: FunnelStep[];
  size?: ScorecardChartSize;
  defaultSelectedKey?: string;
}

function biggestDropIndex(steps: FunnelStep[]): number {
  let max = -1; let idx = -1;
  for (let i = 1; i < steps.length; i++) {
    const d = steps[i].dropFromPrev ?? 0;
    if (d > max) { max = d; idx = i; }
  }
  return idx;
}

export function FunnelBars({ steps, size = 'small', defaultSelectedKey }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultSelectedKey ?? null);

  if (steps.every((s) => s.count === 0)) {
    return (
      <div style={{ backgroundColor: 'var(--sp-s1)', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', padding: '1.5rem', color: 'var(--sp-tx2)', fontSize: '0.75rem', textAlign: 'center' }}>
        No funnel data yet
      </div>
    );
  }

  const barH = size === 'small' ? '18px' : size === 'large' ? '20px' : '24px';
  const labelW = size === 'small' ? '110px' : '130px';
  const dropIndent = size === 'small' ? '118px' : '138px'; // labelW + gap

  const biggestDrop = biggestDropIndex(steps);
  const maxCount    = Math.max(...steps.map((s) => s.count), 1);
  const toggleStep = (key: string) => setSelectedKey((prev) => (prev === key ? null : key));
  const selected = selectedKey ? steps.find((s) => s.key === selectedKey) ?? null : null;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ width: '100%', backgroundColor: 'var(--sp-s1)', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0' }}>
        {steps.map((step, i) => {
          const dropColor = !step.dropFromPrev ? '#10b981' : step.dropFromPrev > 20 ? '#ef4444' : step.dropFromPrev > 10 ? '#f59e0b' : '#10b981';
          const barPct    = (step.count / maxCount) * 100;
          const barColor  = barPct >= 80 ? '#6366f1' : barPct >= 50 ? '#8b5cf6' : '#a78bfa';
          const isSelected = selectedKey === step.key;
          const dropped = i > 0 ? steps[i - 1].count - step.count : 0;

          return (
            <React.Fragment key={step.key}>
              {/* Interstitial drop connector between steps */}
              {i > 0 && step.dropFromPrev !== null && (
                <div style={{ paddingLeft: dropIndent, paddingTop: '0.1rem', paddingBottom: '0.1rem' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                    background: `${dropColor}12`, borderRadius: '4px',
                    padding: '0.1rem 0.45rem', border: `1px solid ${dropColor}28`,
                  }}>
                    <span style={{ fontSize: '0.6rem', color: dropColor, fontWeight: 700 }}>↓ {step.dropFromPrev}%</span>
                    <span style={{ fontSize: '0.55rem', color: 'var(--sp-tx2)' }}>·</span>
                    <span style={{ fontSize: '0.55rem', color: 'var(--sp-tx2)' }}>{dropped.toLocaleString()} left here</span>
                    {i === biggestDrop && (
                      <span style={{ fontSize: '0.52rem', color: '#ef4444', fontWeight: 700, marginLeft: '2px' }}>⚠ biggest drop</span>
                    )}
                  </div>
                </div>
              )}

              {/* Bar row */}
              <div
                onClick={() => toggleStep(step.key)}
                role="button" tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && toggleStep(step.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', borderRadius: '6px', padding: '0.2rem 0.35rem', background: isSelected ? 'rgba(99,102,241,0.06)' : 'transparent', transition: 'background 0.15s' }}
                title="Click to see step details"
              >
                <span style={{ width: labelW, fontSize: size === 'small' ? '0.62rem' : '0.65rem', color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0, lineHeight: 1.2 }}>
                  {step.label}
                </span>
                <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: barH, minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: '3px', transition: 'width 0.5s ease' }} />
                </div>
                <span style={{ width: '48px', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>{step.count.toLocaleString()}</span>
                <span style={{ width: '36px', fontSize: '0.6rem', color: 'var(--sp-tx2)', flexShrink: 0 }}>{step.pctOfFirst > 100 ? '>100%' : `${step.pctOfFirst}%`}</span>
                <span style={{ fontSize: '0.56rem', color: isSelected ? '#6366f1' : '#94a3b8', flexShrink: 0, width: '12px' }}>{isSelected ? '▲' : '▼'}</span>
              </div>
            </React.Fragment>
          );
        })}

        {selected && (
          <FunnelStepDetail step={selected} allSteps={steps} onClose={() => setSelectedKey(null)} />
        )}
      </div>
    </div>
  );
}
