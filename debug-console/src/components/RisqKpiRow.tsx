'use client';

import type { CSSProperties, ReactNode } from 'react';

import polish from '@/components/risq-polish.module.css';

const titleStyle: CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: 700,
  letterSpacing: '0.07em',
  color: '#64748b',
  textTransform: 'uppercase',
  marginBottom: '0.35rem',
};

type PillVariant = 'error' | 'negative' | 'live' | 'green' | 'amber' | 'neutral';

function subMuted(text: string) {
  if (!text) return null;
  return (
    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.22rem', fontWeight: 500 }}>{text}</div>
  );
}

function pill(variant: PillVariant, label: string) {
  const styles: Record<PillVariant, CSSProperties> = {
    error: {
      background: 'linear-gradient(90deg, #fff1f2 0%, #ffe4e6 45%, #fecdd3 100%)',
      color: '#9f1239',
      border: '1px solid #fda4af',
    },
    negative: {
      background: 'linear-gradient(90deg, #fffbeb 0%, #fef3c7 42%, #fde68a 100%)',
      color: '#92400e',
      border: '1px solid #fcd34d',
    },
    live: {
      background: 'linear-gradient(90deg, #ecfdf5 0%, #d1fae5 40%, #a7f3d0 100%)',
      color: '#047857',
      border: '1px solid #6ee7b7',
    },
    green: {
      background: 'linear-gradient(90deg, #ecfdf5 0%, #d1fae5 40%, #a7f3d0 100%)',
      color: '#047857',
      border: '1px solid #6ee7b7',
    },
    amber: {
      background: 'linear-gradient(90deg, #fffbeb 0%, #fef3c7 45%, #fde68a 100%)',
      color: '#b45309',
      border: '1px solid #fcd34d',
    },
    neutral: {
      background: 'linear-gradient(90deg, #f8fbff 0%, #f0f4fa 100%)',
      color: '#475569',
      border: '1px solid #dce4f0',
    },
  };
  const s = styles[variant];
  return (
    <div
      style={{
        alignSelf: 'flex-start',
        marginTop: '0.62rem',
        padding: '0.24rem 0.62rem',
        borderRadius: 999,
        fontSize: '0.62rem',
        fontWeight: 800,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.65)',
        ...s,
      }}
    >
      {label}
    </div>
  );
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

export interface RisqKpiSnapshot {
  feedback: { loading: boolean; error?: string; negative: number; total: number };
  traces: { loading: boolean; error?: string; total: number };
  wau: { loading: boolean; error?: string; curr_wau: number; pct_change: number };
  agenticQa: { loading: boolean; error?: string; passed: number; failed: number; total: number };
  e2e: {
    loading: boolean;
    error?: string;
    passed: number;
    failed: number;
    total: number;
    running: number;
  };
}

export type RisqKpiRowProps = RisqKpiSnapshot & {
  onFeedbackClick?: () => void;
  onTracesClick?: () => void;
  onWauClick?: () => void;
  onAgenticQaClick?: () => void;
  onE2eClick?: () => void;
  qualityPanelSelection?: 'agentic' | 'e2e' | null;
};

const kpiInteractiveSelected: CSSProperties = {
  border: '2px solid #2563eb',
  boxShadow: '0 6px 24px rgba(37, 99, 235, 0.22)',
};

function kpiShell(
  interactive: boolean,
  onClick: (() => void) | undefined,
  children: ReactNode,
  selected?: boolean,
) {
  const selectedStyle: CSSProperties = selected ? kpiInteractiveSelected : {};
  const cardClass = [polish.kpiCard, interactive && onClick ? polish.kpiCardInteractive : null].filter(Boolean).join(' ');
  if (interactive && onClick) {
    return (
      <button type="button" onClick={onClick} className={cardClass} style={selectedStyle}>
        {children}
      </button>
    );
  }
  return (
    <div className={cardClass} style={selectedStyle}>
      {children}
    </div>
  );
}

export default function RisqKpiRow({
  feedback,
  traces,
  wau,
  agenticQa,
  e2e,
  onFeedbackClick,
  onTracesClick,
  onWauClick,
  onAgenticQaClick,
  onE2eClick,
  qualityPanelSelection,
}: RisqKpiRowProps) {
  const fbMain =
    feedback.loading ? '…' : feedback.error ? '—' : `${feedback.negative}/${feedback.total}`;

  const fbPct =
    feedback.loading || feedback.error
      ? null
      : feedback.total > 0
        ? Math.round((feedback.negative / feedback.total) * 100)
        : 0;

  const tracesMain = traces.loading ? '…' : traces.error ? '—' : traces.total.toLocaleString('en-US');

  const wauMain = wau.loading ? '…' : wau.error ? '—' : formatCompact(wau.curr_wau);

  const wauSub =
    wau.loading || wau.error ? '' : `${wau.pct_change >= 0 ? '+' : ''}${wau.pct_change}% vs prev`;

  const wauHealthy = !wau.loading && !wau.error && wau.pct_change >= 0;

  const aqMain =
    agenticQa.loading ? '…' : agenticQa.error ? '—' : `${agenticQa.passed}/${agenticQa.total}`;
  const aqMainColor =
    agenticQa.loading || agenticQa.error
      ? '#64748b'
      : agenticQa.failed > 0
        ? '#dc2626'
        : '#111827';

  const e2eMain =
    e2e.loading ? '…' : e2e.error ? '—' : e2e.total > 0 ? `${e2e.passed}/${e2e.total}` : '—';
  const e2eMainColor =
    e2e.loading || e2e.error
      ? '#64748b'
      : e2e.failed > 0
        ? '#dc2626'
        : '#16a34a';

  return (
    <div className={polish.kpiGrid}>
      {kpiShell(Boolean(onFeedbackClick), onFeedbackClick, (
        <>
          <div style={titleStyle}>Customer feedback</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#ea580c', lineHeight: 1.12, flex: 1 }}>{fbMain}</div>
          {subMuted('last 24h')}
          {feedback.error ? pill('error', 'UNAVAILABLE') : fbPct !== null ? pill('negative', `${fbPct}% negative`) : null}
        </>
      ), false)}

      {kpiShell(Boolean(onTracesClick), onTracesClick, (
        <>
          <div style={titleStyle}>Total traces</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#2563eb', lineHeight: 1.12, flex: 1 }}>{tracesMain}</div>
          {subMuted('7d window')}
          {traces.error ? pill('error', 'UNAVAILABLE') : pill('live', 'LIVE')}
        </>
      ), false)}

      {kpiShell(Boolean(onAgenticQaClick), onAgenticQaClick, (
        <>
          <div style={titleStyle}>Agentic QA</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: aqMainColor, lineHeight: 1.12, flex: 1 }}>{aqMain}</div>
          {subMuted('Last 7 days')}
          {agenticQa.error ? (
            pill('error', 'UNAVAILABLE')
          ) : agenticQa.loading ? null : agenticQa.failed > 0 ? (
            pill('error', `${agenticQa.failed} FAILURES`)
          ) : (
            pill('green', 'ALL PASS')
          )}
        </>
      ), qualityPanelSelection === 'agentic')}

      {kpiShell(Boolean(onE2eClick), onE2eClick, (
        <>
          <div style={titleStyle}>E2E tests</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: e2eMainColor, lineHeight: 1.12, flex: 1 }}>{e2eMain}</div>
          {subMuted('Last 10 prod runs')}
          {e2e.error ? (
            pill('error', 'UNAVAILABLE')
          ) : e2e.loading ? null : e2e.total === 0 ? (
            pill('neutral', 'NO DATA')
          ) : e2e.running > 0 ? (
            pill('negative', `${e2e.running} RUNNING`)
          ) : e2e.failed > 0 ? (
            pill('error', `${e2e.failed} FAILURES`)
          ) : (
            pill('green', 'ALL PASS')
          )}
        </>
      ), qualityPanelSelection === 'e2e')}

      {kpiShell(Boolean(onWauClick), onWauClick, (
        <>
          <div style={titleStyle}>WAU (weekly active users)</div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#16a34a', lineHeight: 1.12, flex: 1 }}>{wauMain}</div>
          {subMuted(wauSub)}
          {wau.error ? (
            pill('error', 'UNAVAILABLE')
          ) : wau.loading ? null : wauHealthy ? (
            pill('green', 'HEALTHY')
          ) : (
            pill('amber', 'VS PRIOR')
          )}
        </>
      ), false)}
    </div>
  );
}
