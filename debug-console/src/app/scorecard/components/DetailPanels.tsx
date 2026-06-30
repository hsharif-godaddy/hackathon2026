'use client';

import React from 'react';

import type { FunnelStep } from '../types';

// ── Shared panel wrapper ──────────────────────────────────────────────────────

interface PanelProps {
  title:    string;
  count:    number;
  label?:   string;
  onClose:  () => void;
  children: React.ReactNode;
}

function DetailPanel({ title, count, label = 'count', onClose, children }: PanelProps) {
  return (
    <div style={{
      marginTop: '0.75rem',
      border: '1.5px solid var(--sp-accent)',
      borderRadius: '10px',
      background: 'var(--sp-s2)',
      padding: '0.75rem 0.9rem',
      display: 'flex', flexDirection: 'column', gap: '0.6rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--sp-tx1)' }}>{title}</div>
          <div style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)', marginTop: '1px' }}>{count.toLocaleString()} {label}</div>
        </div>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--sp-tx2)', padding: '0 2px' }}>✕</button>
      </div>
      {children}
    </div>
  );
}

// ── FunnelStepDetail ──────────────────────────────────────────────────────────

interface FunnelDetailProps {
  step:     FunnelStep;
  allSteps: FunnelStep[];
  onClose:  () => void;
}

export function FunnelStepDetail({ step, allSteps, onClose }: FunnelDetailProps) {
  const stepIdx: number     = allSteps.findIndex((s) => s.key === step.key);
  const prevStep: FunnelStep | null = stepIdx > 0 ? allSteps[stepIdx - 1] : null;
  const nextStep: FunnelStep | null = stepIdx < allSteps.length - 1 ? allSteps[stepIdx + 1] : null;
  const dropCount: number   = prevStep ? prevStep.count - step.count : 0;
  const dropPct: number     = prevStep && prevStep.count > 0 ? Math.round((dropCount / prevStep.count) * 100) : 0;
  const nextDropPct: number | null = nextStep && step.count > 0 ? Math.round(((step.count - nextStep.count) / step.count) * 100) : null;

  const healthColor = (rate: number | null): string => {
    if (rate === null) return '#94a3b8';
    return rate >= 60 ? '#10b981' : rate >= 40 ? '#f59e0b' : '#ef4444';
  };

  return (
    <DetailPanel title={step.label} count={step.count} onClose={onClose}>
      {step.description && (
        <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--sp-tx2)', lineHeight: 1.5, borderLeft: '2px solid var(--sp-accent)', paddingLeft: '0.5rem' }}>
          {step.description}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Funnel position</span>
        {prevStep && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
            <span style={{ color: 'var(--sp-tx2)', width: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prevStep.label}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{prevStep.count.toLocaleString()}</span>
            {dropCount > 0 && <span style={{ color: '#ef4444', fontSize: '0.62rem' }}>− {dropCount.toLocaleString()} ({dropPct}% dropped)</span>}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.72rem', paddingLeft: '0.5rem', borderLeft: '2px solid #6366f1' }}>
          <span style={{ fontWeight: 600, color: 'var(--sp-tx1)', width: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.label}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem' }}>{step.count.toLocaleString()}</span>
          <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>({step.pctOfFirst}% of start)</span>
        </div>
        {nextStep && nextDropPct !== null && nextDropPct > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem' }}>
            <span style={{ color: 'var(--sp-tx2)', width: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nextStep.label}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{nextStep.count.toLocaleString()}</span>
            <span style={{ color: healthColor(100 - nextDropPct), fontSize: '0.62rem', fontWeight: 600 }}>{nextDropPct}% drop to next</span>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}

// ── RevenueStepDetail ─────────────────────────────────────────────────────────

interface RevenueDetailProps {
  stepName:  string;
  count:     number;
  prevCount?: number;
  prevName?:  string;
  nextCount?: number;
  nextName?:  string;
  onClose:   () => void;
}

export function RevenueStepDetail({ stepName, count, prevCount, prevName, nextCount, nextName, onClose }: RevenueDetailProps) {
  const fromPrev    = prevCount && prevCount > 0 ? Math.round((count / prevCount) * 100) : null;
  const toNext      = nextCount !== undefined && count > 0 ? Math.round((nextCount / count) * 100) : null;
  const dropToNext  = toNext !== null ? 100 - toNext : null;
  const hc = (rate: number) => rate >= 60 ? '#10b981' : rate >= 40 ? '#f59e0b' : '#ef4444';

  return (
    <DetailPanel title={stepName} count={count} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {prevName && fromPrev !== null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
            <span style={{ color: 'var(--sp-tx2)' }}>From {prevName}</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: hc(fromPrev) }}>{fromPrev}% conversion</span>
          </div>
        )}
        {nextName && dropToNext !== null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
            <span style={{ color: 'var(--sp-tx2)' }}>Drop before {nextName}</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', color: hc(100 - dropToNext) }}>{dropToNext}% dropped</span>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}
