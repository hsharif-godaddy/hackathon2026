'use client';

import React, { useState } from 'react';

import {
  CARD, FunnelBars, IntervalChart, MetricCard, Section, StatCard, SkeletonChart,
  ScorecardHelpBadge,
} from '../components';
import type { IntervalDataPoint, IntervalSeries, ScorecardHelpInfo } from '../components';
import type { ScorecardLokiData } from '@/lib/analytics/scorecard/loki';

import { bmpVal } from '../hooks/useBmpData';
import type { BmpKV, BmpMetric, ScorecardBmpFeedbackData } from '../hooks/useBmpData';
import type { PdnaTlaFilter } from '../hooks/usePdnaData';
import type { ScorecardS3FeedbackData } from '../hooks/useS3Feedback';
import type { FunnelStep, MetricValue, ScorecardChartSize, ScorecardData, ScorecardRange, TabId, TrendView } from '../types';
import { aggregateByView, viewLabel as trendViewLabel } from '../trendAggregation';

// ── KR Status Banner ──────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div style={{ height: '5px', background: 'var(--sp-s3)', borderRadius: '3px', overflow: 'hidden', width: '100%' }}>
      <div style={{ height: '100%', width: `${clamped}%`, background: color, borderRadius: '3px', transition: 'width 0.5s' }} />
    </div>
  );
}

function DeltaBadge({ delta, deltaPct }: { delta: number | null; deltaPct: number | null }) {
  if (delta === null) return null;
  const up    = delta >= 0;
  const color = up ? '#10b981' : '#ef4444';
  const label = deltaPct != null ? `${up ? '+' : ''}${deltaPct}%` : `${up ? '+' : ''}${delta}`;
  return (
    <span style={{ fontSize: '0.5rem', fontWeight: 600, color, background: `${color}18`, padding: '0.08rem 0.3rem', borderRadius: '10px', whiteSpace: 'nowrap' }}>
      {up ? '↑' : '↓'} {label} vs prev
    </span>
  );
}

const TLA_OPTIONS: Array<{ value: PdnaTlaFilter; label: string; title: string }> = [
  { value: 'all',     label: 'All',     title: 'All apps including internal tenants' },
  { value: 'non-tla', label: 'Non-TLA', title: 'Real customers only — excludes internal/test/marketing tenants' },
  { value: 'tla',     label: 'TLA',     title: 'Internal/test/marketing tenants only' },
];



function BmpErrBadge({ msg }: { msg: string }) {
  return (
    <span style={{ fontSize: '0.52rem', fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '0.1rem 0.4rem', whiteSpace: 'nowrap' }}>
      BMP error: {msg}
    </span>
  );
}

function KRBanner({ data, onGoRevenue, onGoFeedback, s3Feedback, s3Loading, s3Progress, paywallViewsOverride, conversionRateOverride, tlaFilter = 'non-tla', onTlaChange }: { data: ScorecardData; onGoRevenue: () => void; onGoFeedback: () => void; s3Feedback?: ScorecardS3FeedbackData | null; s3Loading?: boolean; s3Progress?: { done: number; total: number } | null; paywallViewsOverride?: number; conversionRateOverride?: number | null; tlaFilter?: PdnaTlaFilter; onTlaChange?: (v: PdnaTlaFilter) => void }) {
  const rv  = data.revenue;
  const pkr = data.prevKR;
  const paywallViews:    number        = paywallViewsOverride    ?? rv.paywallViews;
  const conversionRate:  number | null = conversionRateOverride !== undefined ? conversionRateOverride : rv.conversionRate;

  const kr1Target = 1000;
  const kr1Value  = rv.paidUnitsToday;
  const kr1Pct    = Math.round((kr1Value / kr1Target) * 100);
  const kr1Color  = kr1Value >= kr1Target ? '#10b981' : kr1Value >= kr1Target * 0.7 ? '#f59e0b' : '#ef4444';
  const kr1Status = kr1Value >= kr1Target ? 'On track' : kr1Value >= kr1Target * 0.7 ? 'Caution' : 'At risk';

  const s3Configured   = s3Feedback != null && !s3Feedback.configMissing;
  const s3AvgRating    = s3Configured ? s3Feedback!.avgRating : null;
  const loveScore      = s3Configured ? s3AvgRating : null;
  const kr2Scale       = 7;
  const kr2Target      = 6.0;
  const kr2Source      = '· S3';
  const kr2Pct         = loveScore != null ? Math.round((loveScore / kr2Scale) * 100) : 0;
  const kr2Color       = loveScore == null ? '#94a3b8'
                       : loveScore >= kr2Target ? '#10b981'
                       : loveScore >= kr2Target * 0.85 ? '#f59e0b'
                       : '#ef4444';
  const kr2Status      = loveScore == null ? '—' : loveScore >= kr2Target ? 'On track' : loveScore >= kr2Target * 0.85 ? 'Caution' : 'At risk';

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'stretch' }}>

      {/* KR1 */}
      <div
        role="button" tabIndex={0}
        onClick={onGoRevenue}
        onKeyDown={(e) => e.key === 'Enter' && onGoRevenue()}
        style={{
          flex: '1 1 240px', background: 'var(--sp-s1)', borderRadius: '10px',
          padding: '0.65rem 0.9rem', border: '1px solid var(--sp-border)',
          borderLeft: `3px solid ${kr1Color}`, display: 'flex', flexDirection: 'column', gap: '0.35rem',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.53rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>KR1 · Business Outcome</div>
            <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--sp-tx2)', marginTop: '1px' }}>Paid Units / Day</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.52rem', fontWeight: 600, color: kr1Color, background: `${kr1Color}18`, padding: '0.12rem 0.4rem', borderRadius: '20px', whiteSpace: 'nowrap' }}>
              {kr1Status}
            </span>
            <span style={{ fontSize: '0.5rem', color: 'var(--sp-tx2)' }}>→ Revenue</span>
          </div>
        </div>
        {onTlaChange && (
          <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()} role="group" aria-label="TLA filter">
            {TLA_OPTIONS.map(({ value, label, title }) => (
              <button
                key={value}
                title={title}
                onClick={() => onTlaChange(value)}
                style={{
                  padding: '0.1rem 0.32rem', fontSize: '0.48rem', fontWeight: 600,
                  borderRadius: '10px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: tlaFilter === value ? 'var(--sp-accent)' : 'var(--sp-s3)',
                  color: tlaFilter === value ? '#fff' : 'var(--sp-tx2)',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 900, fontFamily: 'monospace', color: kr1Color, lineHeight: 1 }}>
            {kr1Value.toLocaleString()}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)', fontWeight: 500 }}>/ {kr1Target.toLocaleString()} target</span>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: kr1Color, marginLeft: 'auto' }}>{kr1Pct}%</span>
        </div>
        <ProgressBar pct={kr1Pct} color={kr1Color} />
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)' }}>
            <span style={{ fontWeight: 600, color: 'var(--sp-tx2)' }}>{rv.paidUnitsInRange.toLocaleString()}</span> in range
          </span>
          {paywallViews > 0 && (
            <span style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)' }}>
              <span style={{ fontWeight: 600, color: 'var(--sp-tx2)' }}>{paywallViews.toLocaleString()}</span> paywall views
            </span>
          )}
          {conversionRate != null && (
            <span style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)' }}>
              <span style={{ fontWeight: 600, color: conversionRate >= 10 ? 'var(--sp-success)' : 'var(--sp-warning)' }}>{conversionRate}%</span> conv.
            </span>
          )}
          {pkr && <DeltaBadge delta={pkr.paidUnitsDelta} deltaPct={pkr.paidUnitsDeltaPct} />}
        </div>
      </div>

      {/* KR2 */}
      <div
        role="button" tabIndex={0}
        onClick={onGoFeedback}
        onKeyDown={(e) => e.key === 'Enter' && onGoFeedback()}
        style={{
          flex: '1 1 240px', background: 'var(--sp-s1)', borderRadius: '10px',
          padding: '0.65rem 0.9rem', border: '1px solid var(--sp-border)',
          borderLeft: `3px solid ${kr2Color}`, display: 'flex', flexDirection: 'column', gap: '0.35rem',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.53rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>KR2 · Quality / Satisfaction</div>
            <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--sp-tx2)', marginTop: '1px' }}>Love it or Leave it</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ fontSize: '0.52rem', fontWeight: 600, color: kr2Color, background: `${kr2Color}18`, padding: '0.12rem 0.4rem', borderRadius: '20px', whiteSpace: 'nowrap' }}>
              {kr2Status}
            </span>
            <span style={{ fontSize: '0.5rem', color: 'var(--sp-tx2)' }}>→ Feedback</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 900, fontFamily: 'monospace', color: s3Loading ? 'var(--sp-txm)' : kr2Color, lineHeight: 1 }}>
            {s3Loading && loveScore == null ? '…' : loveScore != null ? loveScore.toFixed(1) : '—'}
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)', fontWeight: 500 }}>
            {s3Configured ? `/ ${kr2Scale}  target ≥${kr2Target} ${kr2Source}` : s3Loading ? 'loading S3…' : 'S3 not configured'}
          </span>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', color: kr2Color, marginLeft: 'auto' }}>
            {loveScore != null ? `${kr2Pct}%` : '—'}
          </span>
        </div>
        <ProgressBar pct={kr2Pct} color={s3Loading ? 'var(--sp-txm)' : kr2Color} />
        {s3Loading && (
          <div style={{ fontSize: '0.5rem', color: 'var(--sp-tx2)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ display: 'inline-block', width: '0.45rem', height: '0.45rem', borderRadius: '50%', background: 'var(--sp-txm)', animation: 'pulse 1.2s ease-in-out infinite' }} />
            {s3Progress ? `Fetching partitions ${s3Progress.done} / ${s3Progress.total}…` : 'Fetching S3 feedback data…'}
          </div>
        )}
        {!s3Loading && (s3Feedback?.partitionErrors ?? 0) > 0 && (
          <div style={{ fontSize: '0.5rem', color: '#f59e0b', marginTop: '0.1rem' }}>
            {s3Feedback!.partitionErrors} partition{s3Feedback!.partitionErrors === 1 ? '' : 's'} failed — score may be incomplete
          </div>
        )}
        {pkr && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.1rem', alignItems: 'center' }}>
            <DeltaBadge delta={pkr.loveScoreDelta} deltaPct={null} />
          </div>
        )}
      </div>

    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sumMetric(metrics: BmpMetric[], name: string): number {
  return metrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, name), 0);
}

// ── Audience Breakdown ────────────────────────────────────────────────────────

interface DimRow {
  value:          string;
  genCount:       number;
  genPct:         number;
  firstPublish:   number;
  publishAttempt: number;
  completionRate: number | null;
}

function buildDimRows(metrics: BmpMetric[], dimKey: string): DimRow[] {
  const groups = new Map<string, { gen: number; firstPublish: number; publishAttempt: number }>();
  for (const m of metrics) {
    const dim: BmpKV | undefined = (m.dimensions ?? []).find((d) => d.name === dimKey);
    const val: string = dim != null && String(dim.value).trim() !== '' ? String(dim.value) : 'unknown';
    const existing = groups.get(val) ?? { gen: 0, firstPublish: 0, publishAttempt: 0 };
    existing.gen            += bmpVal(m.aggregatedSummary, 'generation_triggered');
    existing.firstPublish   += bmpVal(m.aggregatedSummary, 'first_publish_success');
    existing.publishAttempt += bmpVal(m.aggregatedSummary, 'publish_attempt');
    groups.set(val, existing);
  }
  const totalGen: number = Array.from(groups.values()).reduce((a, v) => a + v.gen, 0);
  return Array.from(groups.entries())
    .map(([value, counts]): DimRow => ({
      value,
      genCount:       counts.gen,
      genPct:         totalGen > 0 ? Math.round((counts.gen / totalGen) * 100) : 0,
      firstPublish:   counts.firstPublish,
      publishAttempt: counts.publishAttempt,
      completionRate: counts.gen > 0 ? Math.round((counts.firstPublish / counts.gen) * 100) : null,
    }))
    .sort((a, b) => b.genCount - a.genCount);
}

interface AudienceBreakdownProps {
  entryPointMetrics:     BmpMetric[];
  planTypeMetrics:       BmpMetric[];
  creationSourceMetrics: BmpMetric[];
}

interface AudienceDimTab { key: string; label: string; color: string; metrics: BmpMetric[] }

const AUDIENCE_PAGE_SIZE = 10;

function dropPct(from: number, to: number): number | null {
  return from > 0 ? Math.max(0, Math.round((1 - to / from) * 100)) : null;
}

function dropColor(pct: number): string {
  return pct > 50 ? '#ef4444' : pct > 20 ? '#f59e0b' : '#10b981';
}

const BREAKDOWN_HELP: ScorecardHelpInfo = {
  what: 'Funnel breakdown by dimension — how each segment (e.g. each entry point) progresses from AI generation through to a first published website.',
  how: 'Each row is one dimension value from BMP website_core_events. Columns show raw event counts. The → drop% arrows between columns show what percentage of users fell off at that step: Gen Triggered → Publish Attempts (did they try to publish?), Publish Attempts → First Publish Success (did the publish work?). Conv % = First Publish Success ÷ Generation Triggered × 100.',
  reading: 'High drop at Gen → Attempts: users trigger AI generation but never click publish — engagement problem. High drop at Attempts → Published: users try to publish but fail or abandon — reliability problem. Compare segments to identify which entry points or plan types convert best.',
};


function AudienceBreakdown({ entryPointMetrics, planTypeMetrics, creationSourceMetrics }: AudienceBreakdownProps) {
  const [activeTab, setActiveTab] = useState<string>('entry_point');
  const [page, setPage]           = useState<number>(0);

  const tabs: AudienceDimTab[] = [
    { key: 'entry_point',     label: 'Entry Point',     color: '#3b82f6', metrics: entryPointMetrics },
    { key: 'plan_type',       label: 'Plan Type',       color: '#8b5cf6', metrics: planTypeMetrics },
    { key: 'creation_source', label: 'Creation Source', color: '#10b981', metrics: creationSourceMetrics },
  ];

  const active: AudienceDimTab = tabs.find((t) => t.key === activeTab) ?? tabs[0]!;
  const allRows: DimRow[]      = buildDimRows(active.metrics, active.key);
  const totalPages: number     = Math.max(1, Math.ceil(allRows.length / AUDIENCE_PAGE_SIZE));
  const safePage: number       = Math.min(page, totalPages - 1);
  const visibleRows: DimRow[]  = allRows.slice(safePage * AUDIENCE_PAGE_SIZE, (safePage + 1) * AUDIENCE_PAGE_SIZE);

  const handleTab = (key: string): void => { setActiveTab(key); setPage(0); };

  const COL: React.CSSProperties  = { padding: '0.3rem 0.5rem', textAlign: 'right', fontSize: '0.62rem', fontFamily: 'monospace', fontWeight: 600, whiteSpace: 'nowrap' };
  const HDR: React.CSSProperties  = { padding: '0.25rem 0.5rem', fontSize: '0.55rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right', whiteSpace: 'nowrap' };
  const DHDR: React.CSSProperties = { padding: '0.25rem 0.2rem', fontSize: '0.5rem', color: 'var(--sp-txm)', textAlign: 'center', whiteSpace: 'nowrap' };
  const DCOL: React.CSSProperties = { padding: '0.3rem 0.2rem', textAlign: 'center', fontSize: '0.56rem', fontWeight: 700, whiteSpace: 'nowrap' };

  return (
    <div style={{ backgroundColor: 'var(--sp-s1)', borderRadius: '10px', border: '1px solid var(--sp-border)', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', flex: 1 }}>

      {/* Dimension tabs */}
      <div style={{ display: 'flex', gap: '0.22rem', marginBottom: '0.55rem', flexWrap: 'wrap' }}>
        {tabs.map(({ key, label, color }) => (
          <button
            key={key} type="button" onClick={() => handleTab(key)}
            style={{
              padding: '0.18rem 0.55rem',
              background: activeTab === key ? color : 'var(--sp-s3)',
              color: activeTab === key ? '#fff' : 'var(--sp-tx2)',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
              fontSize: '0.6rem', fontWeight: activeTab === key ? 700 : 500,
              transition: 'background 0.15s',
            }}
          >{label}</button>
        ))}
      </div>

      {/* Table */}
      {visibleRows.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>No data</span>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--sp-border)' }}>
                <th style={{ ...HDR, textAlign: 'left' }}>Value</th>
                <th style={{ ...HDR, color: '#6366f1' }}>Generation Triggered</th>
                <th style={DHDR}>→ drop</th>
                <th style={{ ...HDR, color: '#f59e0b' }}>Publish Attempts</th>
                <th style={DHDR}>→ drop</th>
                <th style={{ ...HDR, color: '#10b981' }}>First Publish Success</th>
                <th style={{ ...HDR, textAlign: 'right' }}>Conv %</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const dGA: number | null = dropPct(r.genCount, r.publishAttempt);
                const dAP: number | null = dropPct(r.publishAttempt, r.firstPublish);
                return (
                  <tr key={r.value} style={{ borderBottom: '1px solid var(--sp-border)' }}>
                    <td style={{ padding: '0.3rem 0.5rem', fontSize: '0.62rem', color: 'var(--sp-tx2)', fontWeight: 500, textTransform: 'capitalize', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.value.replace(/_/g, ' ') || '(unknown)'}
                    </td>
                    <td style={{ ...COL, color: '#6366f1' }}>{r.genCount.toLocaleString()}</td>
                    <td style={{ ...DCOL, color: dGA != null ? dropColor(dGA) : '#d1d5db' }}>
                      {dGA != null ? `↓ ${dGA}%` : '—'}
                    </td>
                    <td style={{ ...COL, color: '#f59e0b' }}>{r.publishAttempt.toLocaleString()}</td>
                    <td style={{ ...DCOL, color: dAP != null ? dropColor(dAP) : '#d1d5db' }}>
                      {dAP != null ? `↓ ${dAP}%` : '—'}
                    </td>
                    <td style={{ ...COL, color: '#10b981' }}>{r.firstPublish.toLocaleString()}</td>
                    <td style={{ ...COL, color: r.completionRate != null && r.completionRate >= 30 ? '#10b981' : '#f59e0b' }}>
                      {r.completionRate != null ? `${r.completionRate}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid var(--sp-border)' }}>
          <button
            type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}
            style={{ padding: '0.15rem 0.5rem', background: 'var(--sp-s3)', color: safePage === 0 ? 'var(--sp-txm)' : 'var(--sp-tx2)', border: '1px solid var(--sp-border)', borderRadius: '3px', cursor: safePage === 0 ? 'default' : 'pointer', fontSize: '0.6rem', fontWeight: 500, opacity: safePage === 0 ? 0.45 : 1 }}
          >← Prev</button>
          <span style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)' }}>{safePage + 1} / {totalPages} · {allRows.length} values</span>
          <button
            type="button" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}
            style={{ padding: '0.15rem 0.5rem', background: 'var(--sp-s3)', color: safePage === totalPages - 1 ? 'var(--sp-txm)' : 'var(--sp-tx2)', border: '1px solid var(--sp-border)', borderRadius: '3px', cursor: safePage === totalPages - 1 ? 'default' : 'pointer', fontSize: '0.6rem', fontWeight: 500, opacity: safePage === totalPages - 1 ? 0.45 : 1 }}
          >Next →</button>
        </div>
      )}

    </div>
  );
}

// ── Dimension Trend Charts ────────────────────────────────────────────────────

const DIM_PALETTE: string[] = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];
const INTENT_ALLOWLIST: Set<string> = new Set(['edit', 'rebuild', 'new_build']);
const DIM_TOP_N = 5;

function buildDimTimeSeries(
  metrics: BmpMetric[],
  dimKey: string,
  allowlist?: Set<string>,
): { points: IntervalDataPoint[]; series: IntervalSeries[] } {
  // Compute totals per value for top-N selection
  const totals = new Map<string, number>();
  for (const m of metrics) {
    const dim: BmpKV | undefined = (m.dimensions ?? []).find((d) => d.name === dimKey);
    const val: string = dim != null && String(dim.value).trim() !== '' ? String(dim.value) : 'unknown';
    if (allowlist && !allowlist.has(val)) continue;
    totals.set(val, (totals.get(val) ?? 0) + bmpVal(m.aggregatedSummary, 'generation_triggered'));
  }

  const topValues: Set<string> = allowlist
    ? allowlist
    : new Set(Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, DIM_TOP_N).map(([k]) => k));

  const dateMap = new Map<string, Map<string, number>>();
  const keyOrder: string[] = [];

  for (const m of metrics) {
    const dim: BmpKV | undefined = (m.dimensions ?? []).find((d) => d.name === dimKey);
    const val: string = dim != null && String(dim.value).trim() !== '' ? String(dim.value) : 'unknown';
    if (!topValues.has(val)) continue;
    if (!keyOrder.includes(val)) keyOrder.push(val);
    for (const interval of (m.intervals ?? [])) {
      const dateKey: string = (interval.startTime ?? '').slice(0, 10);
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map());
      const entry: Map<string, number> = dateMap.get(dateKey)!;
      entry.set(val, (entry.get(val) ?? 0) + bmpVal(interval.intervalSummary, 'generation_triggered'));
    }
  }

  const sortedDates: string[] = Array.from(dateMap.keys()).sort();
  const points: IntervalDataPoint[] = sortedDates.map((date): IntervalDataPoint => {
    const entry: Map<string, number> = dateMap.get(date)!;
    const point: IntervalDataPoint = { label: date.slice(5), _date: date };
    for (const key of keyOrder) point[key] = entry.get(key) ?? 0;
    return point;
  });

  const series: IntervalSeries[] = keyOrder.map((key, i): IntervalSeries => ({
    key,
    label: key.replace(/_/g, ' '),
    color: DIM_PALETTE[i % DIM_PALETTE.length]!,
  }));

  return { points, series };
}

interface DimChartCardProps { title: string; sub: string; metrics: BmpMetric[]; dimKey: string; allowlist?: Set<string>; trendView?: TrendView }

function DimChartCard({ title, sub, metrics, dimKey, allowlist, trendView = 'daily' }: DimChartCardProps) {
  const { points: rawPoints, series } = buildDimTimeSeries(metrics, dimKey, allowlist);
  const points = aggregateByView(rawPoints, series.map((s) => s.key), trendView);
  return (
    <div style={{ backgroundColor: 'var(--sp-s1)', borderRadius: '10px', border: '1px solid var(--sp-border)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div>
        <div style={{ fontSize: '0.56rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
        <div style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)', marginTop: '1px' }}>{sub}</div>
      </div>
      {points.length > 0
        ? <IntervalChart data={points} series={series} size="large" defaultType="line" />
        : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '140px' }}><span style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>No data</span></div>
      }
    </div>
  );
}

// ── Engagement Trend Charts ───────────────────────────────────────────────────

function buildMeasureTimeSeries(
  metrics: BmpMetric[],
  measures: { key: string; label: string; color: string }[],
): { points: IntervalDataPoint[]; series: IntervalSeries[] } {
  const dateMap = new Map<string, Map<string, number>>();
  for (const m of metrics) {
    for (const interval of (m.intervals ?? [])) {
      const dateKey: string = (interval.startTime ?? '').slice(0, 10);
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map());
      const entry: Map<string, number> = dateMap.get(dateKey)!;
      for (const { key } of measures) {
        entry.set(key, (entry.get(key) ?? 0) + bmpVal(interval.intervalSummary, key));
      }
    }
  }
  const sortedDates: string[] = Array.from(dateMap.keys()).sort();
  const points: IntervalDataPoint[] = sortedDates.map((date): IntervalDataPoint => {
    const entry: Map<string, number> = dateMap.get(date)!;
    const point: IntervalDataPoint = { label: date.slice(5), _date: date };
    for (const { key } of measures) point[key] = entry.get(key) ?? 0;
    return point;
  });
  const series: IntervalSeries[] = measures.map(({ key, label, color }): IntervalSeries => ({ key, label, color }));
  return { points, series };
}

const CHAT_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'chat_submit',   label: 'Prompts Sent', color: '#6366f1' },
  { key: 'chat_complete', label: 'Completed',    color: '#10b981' },
  { key: 'chat_failed',   label: 'Failed',       color: '#ef4444' },
];

const PUBLISH_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'publish_attempt',       label: 'Attempted', color: '#0284c7' },
  { key: 'first_publish_success', label: 'Published', color: '#10b981' },
  { key: 'publish_failed',        label: 'Failed',    color: '#ef4444' },
];

// ── Props / Main component ────────────────────────────────────────────────────

interface Props {
  data:                   ScorecardData;
  range:                  string;
  onTabChange:            (tab: TabId) => void;
  s3Feedback?:            ScorecardS3FeedbackData | null;
  lokiData?:              ScorecardLokiData | null;
  websiteData?:           ScorecardBmpFeedbackData | null;
  dimEntryPointData?:     ScorecardBmpFeedbackData | null;
  dimPlanTypeData?:       ScorecardBmpFeedbackData | null;
  dimCreationSourceData?: ScorecardBmpFeedbackData | null;
  dimIntentData?:         ScorecardBmpFeedbackData | null;
  bmpData?:               ScorecardBmpFeedbackData | null;
  paywallData?:           ScorecardBmpFeedbackData | null;
  chartSize?:             ScorecardChartSize;
  trendView?:             TrendView;
  tlaFilter?:             PdnaTlaFilter;
  onTlaChange?:           (v: PdnaTlaFilter) => void;
  rawRange?:              ScorecardRange;
  customFrom?:            string;
  customTo?:              string;
  s3Loading?:             boolean;
  s3Progress?:            { done: number; total: number } | null;
}

export function OverviewTab({ data, range, onTabChange, s3Feedback, s3Loading, s3Progress, lokiData, websiteData, dimEntryPointData, dimPlanTypeData, dimCreationSourceData, dimIntentData, bmpData, paywallData, chartSize = 'large', trendView = 'daily', tlaFilter = 'non-tla', onTlaChange, rawRange, customFrom = '', customTo = '' }: Props) {
  const f  = data.funnel;
  const rv = data.revenue;
  const fb = data.feedback;

  const wMetrics: BmpMetric[] = websiteData?.metrics ?? [];
  const wv = (name: string): number => sumMetric(wMetrics, name);

  const websiteError: string | null      = (websiteData      && !websiteData.configMissing)      ? (websiteData.error      ?? null) : null;
  const paywallError: string | null      = (paywallData      && !paywallData.configMissing)      ? (paywallData.error      ?? null) : null;
  const bmpFeedbackError: string | null  = (bmpData          && !bmpData.configMissing)          ? (bmpData.error          ?? null) : null;
  const dimEPError: string | null        = (dimEntryPointData && !dimEntryPointData.configMissing) ? (dimEntryPointData.error ?? null) : null;
  const dimPTError: string | null        = (dimPlanTypeData   && !dimPlanTypeData.configMissing)   ? (dimPlanTypeData.error   ?? null) : null;
  const dimCSError: string | null        = (dimCreationSourceData && !dimCreationSourceData.configMissing) ? (dimCreationSourceData.error ?? null) : null;
  const dimIntError: string | null       = (dimIntentData     && !dimIntentData.configMissing)     ? (dimIntentData.error     ?? null) : null;

  const ctxStart         = wv('context_gathering_started');
  const buildStart       = wv('initial_build_started');
  const genTriggered     = wv('generation_triggered');
  const chatStart        = wv('chat_start');
  const chatSubmit       = wv('chat_submit');
  const chatComplete     = wv('chat_complete');
  const chatFailed       = wv('chat_failed');
  const chatDelete       = wv('chat_delete');
  const editTriggered    = wv('edit_triggered');
  const rebuildStarted   = wv('rebuild_started');
  const publishAttempt     = wv('publish_attempt');
  const firstPublish       = wv('first_publish_success');
  const republishSuccess   = wv('republish_success');
  const totalPublishSuccess: number = firstPublish + republishSuccess;

  const funnelFirst: number = ctxStart > 0 ? ctxStart : buildStart > 0 ? buildStart : genTriggered;
  const bmpFunnel: FunnelStep[] = funnelFirst > 0 ? (() => {
    type RawStep = { key: string; label: string; count: number; description: string };
    const raw: RawStep[] = [
      ...(ctxStart > 0   ? [{ key: 'context_gathering_started', label: 'Context Gathered',      count: ctxStart,   description: 'User provided context about their website — industry, business type, and goals. Fires when the initial onboarding context step begins.' }] : []),
      ...(buildStart > 0 ? [{ key: 'initial_build_started',     label: 'Initial Build Started', count: buildStart, description: 'The AI started generating the first version of the website. Fires after context is gathered and the first full-page build begins.' }] : []),
      { key: 'generation_triggered',  label: 'Generation Triggered',  count: genTriggered,   description: 'A user triggered an AI generation — includes the initial build plus any subsequent edits, rebuilds, and inline edits. The primary engagement signal.' },
      { key: 'publish_attempt',       label: 'Publish Attempted',     count: publishAttempt, description: 'User clicked Publish to deploy their website. Counts every attempt including retries. Drop from Generation Triggered shows how many users never tried to publish.' },
      { key: 'first_publish_success', label: 'First Published',       count: firstPublish,   description: 'The website was successfully published live for the first time. Primary conversion event and KR1 leading indicator. Drop here indicates publish reliability issues.' },
    ];
    return raw.map((s, i) => ({
      key:          s.key,
      label:        s.label,
      count:        s.count,
      description:  s.description,
      pctOfFirst:   Math.round((s.count / funnelFirst) * 100),
      dropFromPrev: i === 0 || s.key === 'publish_attempt' ? null : raw[i - 1]!.count > 0 ? Math.round(((raw[i - 1]!.count - s.count) / raw[i - 1]!.count) * 100) : null,
    }));
  })() : [];

  const bmpPublishRate: MetricValue = publishAttempt > 0
    ? { rate: Math.round((totalPublishSuccess / publishAttempt) * 100), numerator: totalPublishSuccess, denominator: publishAttempt }
    : { rate: null, numerator: 0, denominator: 0 };

  const bmpTaskCompletion: MetricValue = buildStart > 0
    ? { rate: Math.round((firstPublish / buildStart) * 100), numerator: firstPublish, denominator: buildStart }
    : genTriggered > 0
      ? { rate: Math.round((firstPublish / genTriggered) * 100), numerator: firstPublish, denominator: genTriggered }
      : { rate: null, numerator: 0, denominator: 0 };

  const agentFailureMetric: MetricValue = chatStart > 0
    ? { rate: Math.round((chatFailed / chatStart) * 100), numerator: chatFailed, denominator: chatStart }
    : { rate: null, numerator: 0, denominator: 0 };

  // BMP paywall_conversion_events — for Paywall Conversion KPI card
  const pwMetrics: BmpMetric[]        = paywallData?.metrics ?? [];
  const hasBmpPaywall: boolean        = !paywallData?.configMissing && pwMetrics.length > 0;
  const sumPw = (name: string): number => pwMetrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, name), 0);
  const bmpPaywallViews:    number        = hasBmpPaywall ? sumPw('paywall_view')     : rv.paywallViews;
  const bmpPurchases:       number        = hasBmpPaywall ? sumPw('purchase_success') : rv.purchases;
  const bmpConversionRate:  number | null = bmpPaywallViews > 0
    ? Math.round((bmpPurchases / bmpPaywallViews) * 100)
    : rv.conversionRate;
  const paywallConversionMetric: MetricValue = {
    rate:        bmpConversionRate,
    numerator:   bmpPurchases,
    denominator: bmpPaywallViews,
  };

  const fbMetric        = (bmpData?.metrics ?? []).reduce<BmpMetric['aggregatedSummary']>((acc, m) => {
    for (const kv of (m.aggregatedSummary ?? [])) {
      const existing = acc.find((k) => k.name === kv.name);
      if (existing) existing.value += kv.value;
      else acc.push({ ...kv });
    }
    return acc;
  }, []);
  const fbTotal         = bmpVal(fbMetric, 'total_count');
  const fbPositive      = bmpVal(fbMetric, 'positive_count');
  const bmpThumbsUpMetric: MetricValue = fbTotal > 0
    ? { rate: Math.round((fbPositive / fbTotal) * 100), numerator: fbPositive, denominator: fbTotal }
    : { rate: null, numerator: 0, denominator: 0 };

  const avgChatsPerPublish:    string | null = firstPublish > 0 && chatSubmit    > 0 ? (chatSubmit    / firstPublish).toFixed(1) : null;
  const avgEditsPerPublish:    string | null = firstPublish > 0 && editTriggered > 0 ? (editTriggered / firstPublish).toFixed(1) : null;
  const avgRebuildsPerPublish: string | null = firstPublish > 0 && rebuildStarted > 0 ? (rebuildStarted / firstPublish).toFixed(1) : null;

  const engEditRate:       number | null = chatComplete > 0 ? Math.round(editTriggered  / chatComplete * 100) : null;
  const engRebuildRate:    number | null = chatComplete > 0 ? Math.round(rebuildStarted / chatComplete * 100) : null;
  const engAbandonRate:    number | null = chatSubmit   > 0 ? Math.round(chatDelete     / chatSubmit   * 100) : null;
  const engSuccessRate:    number | null = chatStart    > 0 ? Math.round(chatComplete   / chatStart    * 100) : null;
  const displayPublishRate:     MetricValue  = bmpPublishRate.rate    !== null ? bmpPublishRate    : f.publishRate;
  const displayTaskCompletion:  MetricValue  = bmpTaskCompletion.rate !== null ? bmpTaskCompletion : f.taskCompletion;
  const displayAgentFeedback:   MetricValue  = bmpThumbsUpMetric.rate !== null
    ? bmpThumbsUpMetric
    : { rate: fb.positiveRate, numerator: Math.round(((fb.positiveRate ?? 0) / 100) * fb.totalSubmits), denominator: fb.totalSubmits };
  const displayFunnel:          FunnelStep[] = bmpFunnel.length > 0 ? bmpFunnel : f.steps;
  const hasBmpWebsite:          boolean      = !websiteData?.configMissing && genTriggered > 0;
  const hasEngData:             boolean      = hasBmpWebsite && (chatSubmit > 0 || editTriggered > 0 || rebuildStarted > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

      {/* KR Status Banner */}
      <KRBanner data={data} onGoRevenue={() => onTabChange('revenue')} onGoFeedback={() => onTabChange('feedback')} s3Feedback={s3Feedback} s3Loading={s3Loading} s3Progress={s3Progress} paywallViewsOverride={bmpPaywallViews} conversionRateOverride={bmpConversionRate} tlaFilter={tlaFilter} onTlaChange={onTlaChange} />

      {/* Core Metrics — headline signals */}
      <Section title="Core Metrics" sub={`${hasBmpWebsite ? 'BMP · website_core_events + agent_feedback_count' : 'Performance snapshot'} · last ${range}`}>
        {(websiteError || paywallError || bmpFeedbackError) && (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
            {websiteError     && <BmpErrBadge msg={`website_core_events: ${websiteError}`} />}
            {paywallError     && <BmpErrBadge msg={`paywall_conversion_events: ${paywallError}`} />}
            {bmpFeedbackError && <BmpErrBadge msg={`agent_feedback_count: ${bmpFeedbackError}`} />}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
          <StatCard     label="Task Starts"               value={buildStart > 0 ? buildStart : genTriggered} description={buildStart > 0 ? 'initial_build_started · BMP' : 'generation_triggered · BMP'} accent="info" help={{ what: 'Number of apps that started the AI build process in the selected range — the primary task start signal (Leading Indicator, KR1).', how: 'initial_build_started event count · BMP website_core_events. Falls back to generation_triggered when initial_build_started is unavailable.', reading: 'Use alongside Task Completion Rate to understand funnel size.' }} />
          <MetricCard label="Task Completion Rate"      metric={displayTaskCompletion}  description="first_publish ÷ task starts · BMP"         green={65} amber={50} help={{ what: '% of task starts that resulted in a first website publish — the primary task completion metric (Leading Indicator, KR2).', how: 'first_publish_success ÷ initial_build_started × 100 · BMP website_core_events (airo-instrumentation). Falls back to generation_triggered as denominator when no initial_build_started events exist in the range.', reading: 'Target ≥65%. Low rate = users start but do not complete.' }} />
          <MetricCard label="Purchase Conversion Rate"  metric={paywallConversionMetric} description="Purchases ÷ paywall views · BMP" green={10} amber={5} help={{ what: '% of users who saw the upgrade paywall and completed a plan purchase — the purchase funnel conversion rate (Leading Indicator, KR1).', how: 'purchase_success ÷ paywall_view × 100 · BMP paywall_conversion_events (airo-instrumentation).', reading: 'Target ≥10%. Low rate = paywall is not converting.' }} />
          <MetricCard label="Failure/Error Rate"        metric={agentFailureMetric} description="chat_failed ÷ chat_start · BMP" lowerIsBetter green={5} amber={10} help={{ what: '% of AI generation requests that failed with an error — covers streaming errors, timeouts, and budget exceeded (Leading Indicator, KR2).', how: 'chat_failed ÷ chat_start × 100 · BMP website_core_events (airo-instrumentation). Lower is better.', reading: 'Target <5%. High rate signals AI reliability issues.' }} />
          <MetricCard label="Publish Rate"              metric={displayPublishRate}     description="(first_publish + republish) ÷ attempts · BMP" green={60} amber={40} help={{ what: 'Publish pipeline reliability — share of publish attempts that succeeded (first publish or republish).', how: '(first_publish_success + republish_success) ÷ publish_attempt × 100 · BMP website_core_events (airo-instrumentation).', reading: 'Target ≥60%. Low values indicate publish pipeline failures, not user drop-off.' }} />
          <MetricCard label="Agent Feedback"            metric={displayAgentFeedback} description="thumbs-up rate · BMP agent_feedback_count" green={65} amber={50} help={{ what: 'Share of AI responses rated thumbs-up — a direct signal of response quality and user satisfaction.', how: 'positive_count ÷ total_count × 100 · BMP agent_feedback_count (agent-observability). Rate is computed from raw counts, not the BMP positive_pct field.', reading: 'KR2 leading signal when "Love it or Leave it" score is unavailable. Target ≥65%.' }} />
          {avgChatsPerPublish    !== null && <StatCard label="Avg Chats / Published App"    value={avgChatsPerPublish}    description="chat_submit ÷ first_publish · BMP"    help={{ what: 'Average number of chat turns a user submits before their app is first published.', how: 'chat_submit ÷ first_publish_success · BMP website_core_events.', reading: 'Higher values mean users iterate more before publishing. Compare across date ranges to spot quality changes.' }} />}
          {avgEditsPerPublish    !== null && <StatCard label="Avg Edits / Published App"    value={avgEditsPerPublish}    description="edit_triggered ÷ first_publish · BMP"    help={{ what: 'Average number of inline edits per successfully published app.', how: 'edit_triggered ÷ first_publish_success · BMP website_core_events.', reading: 'Measures iteration depth. Rising trend means users are refining output more before publishing.' }} />}
          {avgRebuildsPerPublish !== null && <StatCard label="Avg Rebuilds / Published App" value={avgRebuildsPerPublish} description="rebuild_started ÷ first_publish · BMP" help={{ what: 'Average number of full regenerations per successfully published app.', how: 'rebuild_started ÷ first_publish_success · BMP website_core_events.', reading: 'High values signal users are dissatisfied with output quality and regenerating from scratch.' }} />}
        </div>
      </Section>

      {/* Row: Creation Funnel + Audience Breakdown — stretch so both cells are equal height */}
      <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : '1fr 1fr', gap: '1rem', alignItems: 'stretch' }}>
        <Section title={<>Funnel Analysis{websiteError ? <> &nbsp;<BmpErrBadge msg={`website_core_events: ${websiteError}`} /></> : null}</>} sub={hasBmpWebsite ? 'BMP · website_core_events · generation_triggered → first_publish_success' : 'Entry Prompt → Output → Refinement → Publish'} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <FunnelBars steps={displayFunnel} size={chartSize} defaultSelectedKey="generation_triggered" />
        </Section>
        <Section
          title={<>Audience Breakdown <ScorecardHelpBadge info={BREAKDOWN_HELP} />{(dimEPError || dimPTError || dimCSError) ? <> &nbsp;<BmpErrBadge msg="dim query failed" /></> : null}</>}
          sub="BMP · generation_triggered → publish_attempt → first_publish_success · tab per dimension"
          style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          <AudienceBreakdown
            entryPointMetrics={dimEntryPointData?.metrics ?? []}
            planTypeMetrics={dimPlanTypeData?.metrics ?? []}
            creationSourceMetrics={dimCreationSourceData?.metrics ?? []}
          />
        </Section>
      </div>

      {/* Dimension Trends — 2×2 grid */}
      <Section title={<>Audience Signals{(dimEPError || dimPTError || dimCSError || dimIntError) ? <> &nbsp;<BmpErrBadge msg="dim query failed" /></> : null}</>} sub="BMP · generation_triggered event count · day-wise by segment · bar / line toggle">
        <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'small' ? 'repeat(4, 1fr)' : chartSize === 'full' ? '1fr' : '1fr 1fr', gap: '0.75rem' }}>
          <DimChartCard title="Intent" sub="edit · rebuild · new build" metrics={dimIntentData?.metrics ?? []} dimKey="intent_category" allowlist={INTENT_ALLOWLIST} trendView={trendView} />
          <DimChartCard title="Plan Type" sub={`top ${DIM_TOP_N} by generation`} metrics={dimPlanTypeData?.metrics ?? []} dimKey="plan_type" trendView={trendView} />
          <DimChartCard title="Entry Point" sub={`top ${DIM_TOP_N} by generation`} metrics={dimEntryPointData?.metrics ?? []} dimKey="entry_point" trendView={trendView} />
          <DimChartCard title="Creation Source" sub={`top ${DIM_TOP_N} by generation`} metrics={dimCreationSourceData?.metrics ?? []} dimKey="creation_source" trendView={trendView} />
        </div>
      </Section>

      {/* Engagement Signals */}
      {!hasEngData && websiteError && (
        <Section title={<>Engagement Signals &nbsp;<BmpErrBadge msg={`website_core_events: ${websiteError}`} /></>} sub={`BMP query failed · last ${range}`}>
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>Chat activity and publish outcome charts unavailable — BMP website_core_events returned an error.</p>
        </Section>
      )}
      {hasEngData && (() => {
        const { points: rawChatPoints,    series: chatSeries    } = buildMeasureTimeSeries(wMetrics, CHAT_MEASURES);
        const { points: rawPublishPoints, series: publishSeries } = buildMeasureTimeSeries(wMetrics, PUBLISH_MEASURES);
        const chatPoints    = aggregateByView(rawChatPoints,    CHAT_MEASURES.map((m) => m.key),    trendView);
        const publishPoints = aggregateByView(rawPublishPoints, PUBLISH_MEASURES.map((m) => m.key), trendView);
        const vLabel = trendViewLabel(trendView);
        return (
          <Section title="Engagement Signals" sub={`BMP · Chat activity + publish outcomes · last ${range}`}>
            {/* Rates row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {([
                { label: 'Chat Prompts',   value: chatSubmit,   desc: 'chat_submit',                 color: '#6366f1',
                  help: { what: 'Total chat prompts submitted by users in the selected range.', how: 'BMP website_core_events · measure: chat_submit', reading: 'Volume signal. Rising trend means more active builder sessions. Compare against Completions to gauge how often prompts resolve.' } satisfies ScorecardHelpInfo },
                { label: 'Completions',    value: chatComplete, desc: 'chat_complete',               color: '#10b981',
                  help: { what: 'Chat turns that finished successfully — the agent returned a result without error.', how: 'BMP website_core_events · measure: chat_complete', reading: 'Numerator for Success Rate. Low completions relative to prompts signals agent errors or user-side issues.' } satisfies ScorecardHelpInfo },
                { label: 'Failures',       value: chatFailed,   desc: 'chat_failed',                 color: chatFailed > 0 ? '#ef4444' : '#94a3b8',
                  help: { what: 'Chat turns that ended in an error (agent failure, timeout, or network drop).', how: 'BMP website_core_events · measure: chat_failed', reading: 'Even a small absolute count at high traffic warrants investigation. Cross-check with Loki agent logs.' } satisfies ScorecardHelpInfo },
                ...(engSuccessRate !== null ? [{ label: 'Success Rate',  value: `${engSuccessRate}%`, desc: 'complete ÷ started',        color: engSuccessRate  >= 80 ? '#10b981' : engSuccessRate  >= 60 ? '#f59e0b' : '#ef4444',
                  help: { what: 'Percentage of started chat turns that completed successfully.', how: 'chat_complete ÷ chat_start × 100 · BMP website_core_events', reading: '≥80% healthy · 60–79% monitor · <60% investigate. Drops here often precede publish failures.' } satisfies ScorecardHelpInfo }] : []),
                ...(engEditRate    !== null ? [{ label: 'Iteration Rate',    value: `${engEditRate}%`,    desc: 'edit_triggered ÷ complete', color: engEditRate     >= 30 ? '#10b981' : engEditRate     >= 15 ? '#f59e0b' : '#94a3b8',
                  help: { what: 'Percentage of completed chat turns that led to an inline edit — a measure of how often users iterate on AI output (Diagnostic: Number of iterations).', how: 'edit_triggered ÷ chat_complete × 100 · BMP website_core_events', reading: '≥30% shows users actively refining output. <15% may mean generation quality is high enough that edits are unnecessary, or that the edit affordance is not visible.' } satisfies ScorecardHelpInfo }] : []),
                ...(engRebuildRate !== null ? [{ label: 'Regeneration Rate', value: `${engRebuildRate}%`, desc: 'rebuild ÷ complete',        color: engRebuildRate  <= 5  ? '#10b981' : engRebuildRate  <= 15 ? '#f59e0b' : '#ef4444',
                  help: { what: 'Percentage of completed chat turns that triggered a full regeneration — a measure of how often users discard and restart AI output (Diagnostic: Number of regenerations).', how: 'rebuild_started ÷ chat_complete × 100 · BMP website_core_events', reading: '≤5% healthy · >15% elevated — high regeneration rates increase infrastructure cost and slow perceived responsiveness.' } satisfies ScorecardHelpInfo }] : []),
                ...(engAbandonRate !== null ? [{ label: 'Abandon Rate',  value: `${engAbandonRate}%`, desc: 'chat_delete ÷ submit',      color: engAbandonRate  <= 10 ? '#10b981' : engAbandonRate  <= 20 ? '#f59e0b' : '#ef4444',
                  help: { what: 'Percentage of submitted prompts that the user subsequently deleted before completion.', how: 'chat_delete ÷ chat_submit × 100 · BMP website_core_events', reading: '≤10% healthy · >20% users are frequently cancelling prompts, possibly due to slow response or incorrect output.' } satisfies ScorecardHelpInfo }] : []),
              ] as { label: string; value: string | number; desc: string; color: string; help: ScorecardHelpInfo }[]).map(({ label, value, desc, color, help }) => (
                <div key={label} style={{ background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
                    <ScorecardHelpBadge info={help} color={color} />
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
                  <div style={{ fontSize: '0.55rem', color: 'var(--sp-tx2)', marginTop: '0.15rem' }}>{desc}</div>
                </div>
              ))}
            </div>
            {/* Trend charts */}
            {chatPoints.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : 'repeat(2, 1fr)', gap: '0.75rem' }}>
                <div style={{ background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: '8px', padding: '0.75rem' }}>
                  <div style={{ fontSize: '0.56rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.1rem' }}>Chat Activity</div>
                  <div style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)', marginBottom: '0.5rem' }}>prompts · completions · failures · {vLabel}</div>
                  <IntervalChart data={chatPoints} series={chatSeries} size={chartSize ?? 'large'} defaultType="line" />
                </div>
                {publishPoints.length > 0 && (
                  <div style={{ background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.56rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.1rem' }}>Publish Activity</div>
                    <div style={{ fontSize: '0.52rem', color: 'var(--sp-tx2)', marginBottom: '0.5rem' }}>attempted · published · failed · {vLabel}</div>
                    <IntervalChart data={publishPoints} series={publishSeries} size={chartSize ?? 'large'} defaultType="line" />
                  </div>
                )}
              </div>
            )}
          </Section>
        );
      })()}

      {/* Loki — Server-Side Publish Signals */}
      {lokiData && !lokiData.configMissing && (lokiData.publish.successes + lokiData.publish.failures) > 0 && (
        <Section title="Server-Side Publish (Loki)" sub="Loki · route.publish.* events — server-side outcome independent of browser instrumentation">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
            {(([
              {
                label: 'Pipeline Starts',
                value: lokiData.publish.begins,
                color: 'var(--sp-tx2)',
                help: {
                  what: 'Number of publish pipelines that started, logged server-side by the agent process.',
                  how:  'route.publish.strategy-selected + route.publish.begin log events in Loki.',
                  reading: 'Includes strategy-selected events emitted before the build starts. Not used as the success-rate denominator — see Publish Success Rate.',
                } satisfies ScorecardHelpInfo,
              },
              {
                label: 'Published Successfully',
                value: lokiData.publish.successes,
                color: '#10b981',
                help: {
                  what: 'Publish pipelines that completed without error — build, archive, and deploy all succeeded.',
                  how:  'route.publish.success log events in Loki.',
                  reading: 'Used as the numerator in Publish Success Rate.',
                } satisfies ScorecardHelpInfo,
              },
              {
                label: 'Publish Failures',
                value: lokiData.publish.failures,
                color: lokiData.publish.failures > 0 ? '#ef4444' : 'var(--sp-tx2)',
                help: {
                  what: 'Total publish pipeline failures — covers both build failures and archive/upload failures.',
                  how:  'Sum of route.publish.*.build.failed + route.publish.*.archive.failed events.',
                  reading: 'Used as the denominator alongside successes in Publish Success Rate.',
                } satisfies ScorecardHelpInfo,
              },
              {
                label: 'Build Step Failed',
                value: lokiData.publish.buildFailed,
                color: lokiData.publish.buildFailed > 0 ? '#f59e0b' : 'var(--sp-tx2)',
                help: {
                  what: 'Pipelines that failed specifically at the static-site build step.',
                  how:  'route.publish.default.build.failed + route.publish.paas.build.failed + route.publish.build.failed',
                  reading: 'Subset of Publish Failures. Common causes: out-of-memory, invalid template output, or missing build dependencies.',
                } satisfies ScorecardHelpInfo,
              },
              {
                label: 'Archive Step Failed',
                value: lokiData.publish.archiveFailed,
                color: lokiData.publish.archiveFailed > 0 ? '#f59e0b' : 'var(--sp-tx2)',
                help: {
                  what: 'Pipelines where the build succeeded but the file-archive or upload step failed.',
                  how:  'route.publish.default.archive.failed + route.publish.paas.archive.failed + route.publish.archive.failed + route.publish.git-archive.failed',
                  reading: 'Subset of Publish Failures. Common causes: S3 upload errors, git push failures, or timeout during archive creation.',
                } satisfies ScorecardHelpInfo,
              },
              {
                label: 'Publish Success Rate',
                value: lokiData.publish.successRate != null ? `${lokiData.publish.successRate}%` : '—',
                color: lokiData.publish.successRate != null
                  ? (lokiData.publish.successRate >= 70 ? '#10b981' : lokiData.publish.successRate >= 50 ? '#f59e0b' : '#ef4444')
                  : 'var(--sp-tx2)',
                help: {
                  what: 'Percentage of completed publish pipelines that succeeded.',
                  how:  'Published Successfully ÷ (Published Successfully + Publish Failures) × 100. Excludes Pipeline Starts to avoid counting jobs with no definitive outcome.',
                  reading: '≥70% green · 50–69% amber · <50% red.',
                } satisfies ScorecardHelpInfo,
              },
            ] as Array<{ label: string; value: number | string; color: string; help: ScorecardHelpInfo }>).map(({ label, value, color, help }) => (
              <div key={label} style={{ background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
                  <ScorecardHelpBadge info={help} color={color} />
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
              </div>
            )))}
          </div>
          {lokiData.error && (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#f59e0b' }}>Query warning: {lokiData.error}</p>
          )}
        </Section>
      )}
      {lokiData && !lokiData.configMissing && (lokiData.publish.successes + lokiData.publish.failures) === 0 && (
        <Section title="Server-Side Publish (Loki)" sub="Loki · route.publish.* events">
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>No publish events in Loki for this range.</p>
          {lokiData.error && (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.65rem', color: '#f59e0b' }}>Query warning: {lokiData.error}</p>
          )}
        </Section>
      )}
      {(!lokiData || lokiData.configMissing) && (
        <Section title="Server-Side Publish (Loki)" sub="Set LOKI_ENDPOINT in .env.local to enable server-side publish outcome signals">
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--sp-tx2)' }}>Loki not configured — server-side signals unavailable.</p>
        </Section>
      )}

    </div>
  );
}
