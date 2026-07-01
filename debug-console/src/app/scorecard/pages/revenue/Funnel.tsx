'use client';

import React, { useState } from 'react';

import { CARD, IntervalChart, ScorecardHelpBadge, Section, cardGrid } from '../../components';
import type { IntervalDataPoint, IntervalSeries } from '../../components';
import { SkeletonBlock, SkeletonChart } from '../../components/Skeleton';
import { bmpVal } from '../../hooks/useBmpData';
import type { BmpInterval, BmpKV, BmpMetric, ScorecardBmpFeedbackData } from '../../hooks/useBmpData';
import type { ScorecardChartSize, ScorecardData, TrendView } from '../../types';
import { aggregateByView, viewLabel } from '../../trendAggregation';

// ── Helpers ────────────────────────────────────────────────────────────────────

function sumMetrics(metrics: BmpMetric[], name: string): number {
  return metrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, name), 0);
}

function filterByDim(metrics: BmpMetric[], dimKey: string, dimValue: string): BmpMetric[] {
  return metrics.filter((m) =>
    (m.dimensions ?? []).some((d: BmpKV) => d.name === dimKey && String(d.value) === dimValue),
  );
}

function groupByDim(
  metrics: BmpMetric[],
  dimKey: string,
  measureName: string,
): Array<{ label: string; count: number }> {
  const groups = new Map<string, number>();
  for (const m of metrics) {
    const dim: BmpKV | undefined = (m.dimensions ?? []).find((d: BmpKV) => d.name === dimKey);
    const val: string = dim != null && String(dim.value).trim() !== '' ? String(dim.value) : 'unknown';
    groups.set(val, (groups.get(val) ?? 0) + bmpVal(m.aggregatedSummary, measureName));
  }
  return Array.from(groups.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function buildMergedTimeSeries(
  metricsA: BmpMetric[],
  metricsB: BmpMetric[],
  measures: { key: string; from: 'a' | 'b'; label: string; color: string }[],
): { points: IntervalDataPoint[]; series: IntervalSeries[] } {
  const dateMap = new Map<string, Map<string, number>>();

  const ingest = (metrics: BmpMetric[], src: 'a' | 'b') => {
    for (const m of metrics) {
      for (const interval of (m.intervals ?? [] as BmpInterval[])) {
        const dateKey: string = (interval.startTime ?? '').slice(0, 10);
        if (!dateKey) continue;
        if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map());
        const entry: Map<string, number> = dateMap.get(dateKey)!;
        for (const { key, from } of measures) {
          if (from === src) {
            entry.set(key, (entry.get(key) ?? 0) + bmpVal(interval.intervalSummary, key));
          }
        }
      }
    }
  };

  ingest(metricsA, 'a');
  ingest(metricsB, 'b');

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

// ── Funnel Step Types ──────────────────────────────────────────────────────────

interface FunnelStepData {
  key:      string;
  label:    string;
  sublabel: string;
  count:    number;
}

const FUNNEL_COLORS: string[] = ['#1e40af', '#0284c7', '#0891b2', '#7c3aed', '#6366f1', '#059669'];

// ── Funnel Renderer ────────────────────────────────────────────────────────────

function JourneyFunnel({
  steps, selectedKey, onStepClick, chartSize,
}: {
  steps: FunnelStepData[];
  selectedKey: string | null;
  onStepClick: (key: string) => void;
  chartSize: ScorecardChartSize;
}): React.ReactElement {
  const base: number = steps.length > 0 ? (steps[0]?.count ?? 0) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {steps.map((step, idx) => {
        const pct: number       = base > 0 ? Math.round((step.count / base) * 100) : 0;
        const prevStep          = idx > 0 ? steps[idx - 1] : null;
        const drop: number | null = prevStep && prevStep.count > 0
          ? Math.round(((prevStep.count - step.count) / prevStep.count) * 100)
          : null;
        const isSelected: boolean = selectedKey === step.key;
        const color: string = FUNNEL_COLORS[idx % FUNNEL_COLORS.length] ?? '#6366f1';

        return (
          <React.Fragment key={step.key}>
            {drop !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingLeft: '140px' }}>
                <div style={{ width: '2px', height: '14px', background: 'var(--sp-border)', marginLeft: '0.5rem', flexShrink: 0 }} />
                <span style={{
                  fontSize: '0.57rem', fontWeight: 700,
                  color: drop > 40 ? '#ef4444' : drop > 20 ? '#f59e0b' : '#10b981',
                  background: drop > 40 ? 'rgba(239,68,68,0.12)' : drop > 20 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                  padding: '0.04rem 0.3rem', borderRadius: '8px',
                }}>
                  ↓ {drop}% drop-off
                </span>
              </div>
            )}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onStepClick(step.key)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && onStepClick(step.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                cursor: 'pointer', borderRadius: '6px',
                padding: '0.22rem 0.4rem',
                background: isSelected ? 'rgba(99,102,241,0.07)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ width: '140px', flexShrink: 0, textAlign: 'right' }}>
                <div style={{ fontSize: '0.63rem', color: 'var(--sp-tx2)', lineHeight: 1.3 }}>{step.label}</div>
                <div style={{ fontSize: '0.54rem', color: 'var(--sp-txm)', lineHeight: 1.2 }}>{step.sublabel}</div>
              </div>
              <div style={{
                flex: 1, background: 'var(--sp-s3)', borderRadius: '4px',
                height: chartSize === 'small' ? '20px' : '24px', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', background: color,
                  borderRadius: '4px', transition: 'width 0.55s',
                }} />
              </div>
              <span style={{ width: '58px', fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>
                {step.count.toLocaleString()}
              </span>
              <span style={{ width: '38px', fontSize: '0.62rem', color: 'var(--sp-tx2)', flexShrink: 0 }}>
                {pct}%
              </span>
              <span style={{ fontSize: '0.6rem', color: isSelected ? '#6366f1' : 'var(--sp-txm)', flexShrink: 0, width: '14px' }}>
                {isSelected ? '▲' : '▼'}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Mini bar for drill-down panels ────────────────────────────────────────────

function MiniBreakdown({
  rows, total, colors,
}: {
  rows: Array<{ label: string; count: number }>;
  total: number;
  colors: string[];
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {rows.map((row, i) => {
        const pct: number = total > 0 ? Math.round((row.count / total) * 100) : 0;
        const color: string = colors[i % colors.length] ?? '#6366f1';
        return (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '90px', fontSize: '0.62rem', color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0, textTransform: 'capitalize' }}>
              {row.label.replace(/_/g, ' ')}
            </span>
            <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '16px', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s' }} />
            </div>
            <span style={{ width: '50px', fontSize: '0.68rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>
              {row.count.toLocaleString()}
            </span>
            <span style={{ width: '32px', fontSize: '0.6rem', color: 'var(--sp-tx2)', flexShrink: 0 }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  data:            ScorecardData;
  websiteData:     ScorecardBmpFeedbackData | null;
  dimPlanTypeData: ScorecardBmpFeedbackData | null;
  dimIntentData:   ScorecardBmpFeedbackData | null;
  paywallData:     ScorecardBmpFeedbackData | null;
  range:           string;
  chartSize:       ScorecardChartSize;
  trendView?:      TrendView;
  bmpLoading?:     boolean;
}

// ── Trend measures for combined chart ─────────────────────────────────────────

const FUNNEL_TREND_MEASURES: { key: string; from: 'a' | 'b'; label: string; color: string }[] = [
  { key: 'initial_build_started',  from: 'a', label: 'Task Starts',     color: '#1e40af' },
  { key: 'initial_build_completed',from: 'a', label: 'Initial Builds',  color: '#0284c7' },
  { key: 'paywall_view',           from: 'b', label: 'Paywall Hits',    color: '#7c3aed' },
  { key: 'purchase_success',       from: 'b', label: 'Purchases',       color: '#10b981' },
  { key: 'first_publish_success',  from: 'a', label: 'Task Completions',color: '#059669' },
];

const INTENT_COLORS: string[] = ['#0284c7', '#7c3aed', '#0891b2', '#94a3b8'];
const PLAN_COLORS: string[]   = ['#0284c7', '#7c3aed', '#0891b2', '#f59e0b'];

// ── Main component ─────────────────────────────────────────────────────────────

export function RevenueFunnel({
  data, websiteData, dimPlanTypeData, dimIntentData, paywallData,
  range, chartSize, trendView = 'daily', bmpLoading = false,
}: Props): React.ReactElement {
  const [userMode, setUserMode]         = useState<'free' | 'paid' | 'all'>('all');
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  const rv              = data.revenue;
  const wsMetrics:   BmpMetric[] = websiteData?.metrics     ?? [];
  const pwMetrics:   BmpMetric[] = paywallData?.metrics     ?? [];
  const ptMetrics:   BmpMetric[] = dimPlanTypeData?.metrics ?? [];
  const intMetrics:  BmpMetric[] = dimIntentData?.metrics   ?? [];

  const freeMetrics: BmpMetric[] = filterByDim(ptMetrics, 'plan_type', 'free');
  const paidMetrics: BmpMetric[] = ptMetrics.filter((m) =>
    (m.dimensions ?? []).some((d: BmpKV) => d.name === 'plan_type' && ['starter', 'professional', 'ultimate'].includes(String(d.value))),
  );

  const hasBmpWebsite: boolean = !websiteData?.configMissing && wsMetrics.length > 0;
  const hasBmpPaywall: boolean = !paywallData?.configMissing && pwMetrics.length > 0;

  // ── Per-lens funnel measures (same fields, different dimension filter) ─────
  // Task Starts: initial_build_started (first AI build triggered — entry to the build funnel)
  const freeTaskStarts:    number = sumMetrics(freeMetrics, 'initial_build_started');
  const paidTaskStarts:    number = sumMetrics(paidMetrics, 'initial_build_started');
  const allTaskStarts:     number = hasBmpWebsite ? sumMetrics(wsMetrics, 'initial_build_started')    : 0;

  // Initial Build Complete: initial_build_completed (website successfully generated)
  const freeInitialBuild:  number = sumMetrics(freeMetrics, 'initial_build_completed');
  const paidInitialBuild:  number = sumMetrics(paidMetrics, 'initial_build_completed');
  const allInitialBuild:   number = hasBmpWebsite ? sumMetrics(wsMetrics, 'initial_build_completed') : 0;

  // Publish Intent: publish_attempt (user initiated a publish action)
  const freePublishIntent: number = sumMetrics(freeMetrics, 'publish_attempt');
  const paidPublishIntent: number = sumMetrics(paidMetrics, 'publish_attempt');
  const allPublishIntent:  number = hasBmpWebsite ? sumMetrics(wsMetrics, 'publish_attempt')         : 0;

  // Task Complete: first_publish_success (+ republish_success for all-user lens from websiteData)
  const freeTaskComplete:  number = sumMetrics(freeMetrics, 'first_publish_success');
  const paidTaskComplete:  number = sumMetrics(paidMetrics, 'first_publish_success');
  const firstPublishAll:   number = hasBmpWebsite ? sumMetrics(wsMetrics, 'first_publish_success') : 0;
  const republishAll:      number = hasBmpWebsite ? sumMetrics(wsMetrics, 'republish_success')     : 0;
  const allTaskComplete:   number = firstPublishAll + republishAll;

  // Paywall + Purchase always from all-user paywall data (no plan-type split available)
  const paywallViews: number = hasBmpPaywall ? sumMetrics(pwMetrics, 'paywall_view')     : rv.paywallViews;
  const purchases:    number = hasBmpPaywall ? sumMetrics(pwMetrics, 'purchase_success') : rv.purchases;

  const lensLabel: string = userMode === 'free' ? 'free' : userMode === 'paid' ? 'paid' : 'all';
  const taskStarts:    number = userMode === 'all' ? allTaskStarts    : userMode === 'paid' ? paidTaskStarts    : freeTaskStarts;
  const initialBuild:  number = userMode === 'all' ? allInitialBuild  : userMode === 'paid' ? paidInitialBuild  : freeInitialBuild;
  const publishIntent: number = userMode === 'all' ? allPublishIntent : userMode === 'paid' ? paidPublishIntent : freePublishIntent;
  const taskComplete:  number = userMode === 'all' ? allTaskComplete  : userMode === 'paid' ? paidTaskComplete  : freeTaskComplete;

  const taskCompleteSublabel: string = userMode === 'all'
    ? 'first_publish_success + republish_success · all'
    : `first_publish_success · ${lensLabel}`;

  const funnelSteps: FunnelStepData[] = [
    { key: 'task_starts',    label: 'Task Starts',    sublabel: `initial_build_started · ${lensLabel}`,         count: taskStarts    },
    { key: 'initial_build',  label: 'Initial Build',  sublabel: `initial_build_completed · ${lensLabel}`,       count: initialBuild  },
    { key: 'publish_intent', label: 'Publish Intent', sublabel: `publish_attempt · ${lensLabel}`,               count: publishIntent },
    ...(userMode === 'all' ? [
      { key: 'paywall_hit',  label: 'Paywall Hit',    sublabel: 'paywall_view · all users',                     count: paywallViews  } as FunnelStepData,
      { key: 'purchase',     label: 'Purchase',       sublabel: 'purchase_success · all users',                 count: purchases     } as FunnelStepData,
    ] : []),
    { key: 'task_complete',  label: 'Published',      sublabel: taskCompleteSublabel,                           count: taskComplete  },
  ];

  const toggleStep = (key: string): void => setSelectedStep((prev) => (prev === key ? null : key));

  const intentByBuild:        Array<{ label: string; count: number }> = groupByDim(intMetrics, 'intent_category', 'initial_build_completed');
  const intentByBuildStarted: Array<{ label: string; count: number }> = groupByDim(intMetrics, 'intent_category', 'initial_build_started');
  const intentByBuildTotal:        number = intentByBuild.reduce((s, r) => s + r.count, 0);
  const intentByBuildStartedTotal: number = intentByBuildStarted.reduce((s, r) => s + r.count, 0);

  const planMix: Array<{ label: string; count: number }> = [
    { label: 'Starter',      count: hasBmpPaywall ? sumMetrics(pwMetrics, 'purchase_starter')      : rv.purchaseStarter  },
    { label: 'Professional', count: hasBmpPaywall ? sumMetrics(pwMetrics, 'purchase_professional') : rv.purchasePro      },
    { label: 'Ultimate',     count: hasBmpPaywall ? sumMetrics(pwMetrics, 'purchase_ultimate')     : rv.purchaseUltimate },
    { label: 'Credits',      count: hasBmpPaywall ? sumMetrics(pwMetrics, 'credits_purchase')      : rv.creditPurchaseSuccess },
  ].filter((p) => p.count > 0);
  const planTotal: number = planMix.reduce((s, p) => s + p.count, 0);

  const convBuild2Publish: number | null = initialBuild > 0 && publishIntent > 0
    ? Math.round((publishIntent / initialBuild) * 100) : null;
  const convPaywall2Buy:   number | null = userMode === 'all' && paywallViews > 0
    ? Math.round((purchases / paywallViews) * 100) : null;
  const convStart2Done:    number | null = taskStarts > 0 && taskComplete > 0
    ? Math.round((taskComplete / taskStarts) * 100) : null;

  // Upgrade banner metrics live in paywallData (upgrade_banner_view/click/dismiss are in SCORECARD_PAYWALL_MEASURES)
  const bannerViews:   number = hasBmpPaywall ? sumMetrics(pwMetrics, 'upgrade_banner_view')    : rv.upgradeBannerView;
  const bannerClicks:  number = hasBmpPaywall ? sumMetrics(pwMetrics, 'upgrade_banner_click')   : rv.upgradeBannerClick;
  const bannerDismiss: number = hasBmpPaywall ? sumMetrics(pwMetrics, 'upgrade_banner_dismiss') : rv.upgradeBannerClose;
  const bannerCtr:     number | null = bannerViews > 0 ? Math.round((bannerClicks / bannerViews) * 1000) / 10 : null;

  const hasUpgradeBanner: boolean = (bannerViews + bannerClicks) > 0;
  const hasD2p:           boolean = rv.d2pModalShown > 0;
  const hasPaymentSkill:  boolean = rv.paymentIntentDetected > 0;

  const activeTrendMetricsA: BmpMetric[] = userMode === 'free' ? freeMetrics : userMode === 'paid' ? paidMetrics : wsMetrics;
  const activeTrendMeasures: typeof FUNNEL_TREND_MEASURES = userMode === 'all'
    ? FUNNEL_TREND_MEASURES
    : FUNNEL_TREND_MEASURES.filter((m) => m.from === 'a');
  const { points: rawTrend, series: trendSeries } = buildMergedTimeSeries(activeTrendMetricsA, pwMetrics, activeTrendMeasures);
  const numDays: number = rawTrend.length;
  const trendPoints: IntervalDataPoint[] = aggregateByView(
    rawTrend,
    FUNNEL_TREND_MEASURES.map((m) => m.key),
    trendView,
  );
  const vLabel: string = viewLabel(trendView);

  const bmpSource: string = hasBmpPaywall ? 'BMP' : 'PDNA (BMP pending)';

  const filterPillStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
    fontSize: '11.5px', fontWeight: active ? 600 : 500,
    border: '1px solid transparent', outline: 'none',
    background: active ? 'var(--sp-accent)' : 'var(--sp-s3)',
    color: active ? '#fff' : 'var(--sp-tx2)',
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.12s, color 0.12s',
  });

  const noData: boolean = taskStarts === 0 && initialBuild === 0;

  if (bmpLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div style={{ borderTop: '1px solid var(--sp-border)', paddingTop: '0.5rem' }}>
          <SkeletonBlock w="160px" h="32px" radius="8px" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem', background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: '10px' }}>
          {[100, 78, 62, 48, 38, 55].map((w, i) => (
            <SkeletonBlock key={i} w={`${w}%`} h="36px" radius="6px" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
        <SkeletonChart height="148px" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

      {/* Lens filter — top bar, same pattern as Apps TLA filter */}
      <div style={{ borderTop: '1px solid var(--sp-border)', paddingTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--sp-s1)', border: '1px solid var(--sp-border)', borderRadius: '8px', padding: '4px 8px' }}>
            <span style={{ fontSize: '9.5px', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap', marginRight: '2px' }}>Lens</span>
            <button type="button" style={filterPillStyle(userMode === 'all')}  onClick={() => setUserMode('all')}>All</button>
            <button type="button" style={filterPillStyle(userMode === 'free')} onClick={() => setUserMode('free')}>Free</button>
            <button type="button" style={filterPillStyle(userMode === 'paid')} onClick={() => setUserMode('paid')}>Paid</button>
          </div>
        </div>
      </div>

      {/* Journey Funnel */}
      <Section
        title="Journey Funnel"
        sub={`${bmpSource} · ${userMode === 'free' ? 'Free-plan users (4 steps · paywall/purchase unavailable per lens)' : userMode === 'paid' ? 'Paid users · starter/pro/ultimate (4 steps · paywall/purchase unavailable per lens)' : 'All users · full 6-step funnel'} · last ${range} · click step for detail`}
      >
        <div style={CARD}>
          {noData ? (
            <div style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)', padding: '0.5rem' }}>
              No funnel data for this range — check BMP connection.
            </div>
          ) : (
            <>
              {/* Step-to-step conversion rate summary */}
              {(convBuild2Publish !== null || convPaywall2Buy !== null || convStart2Done !== null) && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--sp-border)' }}>
                  {[
                    { label: 'Build → Publish', rate: convBuild2Publish, nums: `${publishIntent.toLocaleString()} of ${initialBuild.toLocaleString()}` },
                    { label: 'Paywall → Purchase', rate: convPaywall2Buy, nums: `${purchases.toLocaleString()} of ${paywallViews.toLocaleString()}` },
                    { label: 'Start → Published', rate: convStart2Done, nums: `${taskComplete.toLocaleString()} of ${taskStarts.toLocaleString()}` },
                  ].map(({ label, rate, nums }) => rate !== null ? (
                    <div key={label} style={{ flex: '1 1 130px', display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.45rem 0.65rem', background: 'var(--sp-s2)', borderRadius: '6px' }}>
                      <span style={{ fontSize: '0.54rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                      <span style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'monospace', color: rate >= 50 ? '#10b981' : rate >= 25 ? '#f59e0b' : '#ef4444' }}>
                        {rate}%
                      </span>
                      <span style={{ fontSize: '0.54rem', color: 'var(--sp-tx2)' }}>{nums}</span>
                    </div>
                  ) : null)}
                </div>
              )}
              <JourneyFunnel
                steps={funnelSteps}
                selectedKey={selectedStep}
                onStepClick={toggleStep}
                chartSize={chartSize}
              />

              {selectedStep && (() => {
                const step: FunnelStepData | undefined = funnelSteps.find((s) => s.key === selectedStep);
                if (!step) return null;
                const idx: number = funnelSteps.findIndex((s) => s.key === selectedStep);
                const prev: FunnelStepData | undefined = idx > 0 ? funnelSteps[idx - 1] : undefined;
                const next: FunnelStepData | undefined = idx < funnelSteps.length - 1 ? funnelSteps[idx + 1] : undefined;
                const retentionFromPrev: number | null = prev && prev.count > 0
                  ? Math.round((step.count / prev.count) * 100) : null;
                const dropToNext: number | null = next && step.count > 0
                  ? Math.round(((step.count - next.count) / step.count) * 100) : null;
                const avgPerDay: number | null = numDays > 0 ? Math.round(step.count / numDays) : null;
                const borderColor: string = FUNNEL_COLORS[idx % FUNNEL_COLORS.length] ?? '#6366f1';

                // Step-specific rates
                const buildSuccessRate:    number | null = selectedStep === 'initial_build'  && taskStarts    > 0 ? Math.round((initialBuild  / taskStarts)    * 100) : null;
                const publishAttemptRate:  number | null = selectedStep === 'publish_intent' && initialBuild  > 0 ? Math.round((publishIntent / initialBuild)  * 100) : null;
                const paywallConvRate:     number | null = selectedStep === 'paywall_hit'    && paywallViews  > 0 ? Math.round((purchases    / paywallViews)  * 100) : null;
                const bannerToPaywallPct:  number | null = selectedStep === 'paywall_hit'    && paywallViews  > 0 && bannerClicks > 0 ? Math.round((bannerClicks / paywallViews) * 100) : null;
                const overallCompletionRate: number | null = selectedStep === 'task_complete' && taskStarts   > 0 && taskComplete > 0 ? Math.round((taskComplete / taskStarts) * 100) : null;
                const publishSuccessRate:  number | null = selectedStep === 'task_complete'  && publishIntent > 0 ? Math.round((taskComplete / publishIntent) * 100) : null;

                const subCount: number = planMix.filter((p) => p.label !== 'Credits').reduce((s, p) => s + p.count, 0);
                const creditsCount: number = planMix.find((p) => p.label === 'Credits')?.count ?? 0;

                type RateChip = { label: string; value: string; color: string };
                const chips: RateChip[] = [];
                if (retentionFromPrev !== null) chips.push({ label: `Reached from ${prev?.label ?? ''}`, value: `${retentionFromPrev}%`, color: retentionFromPrev >= 50 ? '#10b981' : retentionFromPrev >= 25 ? '#f59e0b' : '#ef4444' });
                if (dropToNext        !== null) chips.push({ label: `Drop-off → ${next?.label ?? ''}`,   value: `${dropToNext}%`,        color: dropToNext        > 50  ? '#ef4444' : dropToNext        > 25  ? '#f59e0b' : '#10b981' });
                if (buildSuccessRate   !== null) chips.push({ label: 'Build rate (÷ task starts)',         value: `${buildSuccessRate}%`,   color: buildSuccessRate   >= 70 ? '#10b981' : buildSuccessRate   >= 40 ? '#f59e0b' : '#ef4444' });
                if (publishAttemptRate !== null) chips.push({ label: 'Attempt rate (÷ initial builds)',    value: `${publishAttemptRate}%`, color: publishAttemptRate >= 50 ? '#10b981' : publishAttemptRate >= 25 ? '#f59e0b' : '#ef4444' });
                if (paywallConvRate    !== null) chips.push({ label: 'Paywall → purchase conv.',           value: `${paywallConvRate}%`,    color: paywallConvRate    >= 10 ? '#10b981' : paywallConvRate    >= 5  ? '#f59e0b' : '#ef4444' });
                if (overallCompletionRate !== null) chips.push({ label: 'Overall: start → published',     value: `${overallCompletionRate}%`, color: overallCompletionRate >= 30 ? '#10b981' : overallCompletionRate >= 15 ? '#f59e0b' : '#ef4444' });
                if (publishSuccessRate !== null) chips.push({ label: 'Attempt → published rate',          value: `${publishSuccessRate}%`, color: publishSuccessRate >= 70 ? '#10b981' : publishSuccessRate >= 40 ? '#f59e0b' : '#ef4444' });

                return (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--sp-s2)', borderRadius: '8px', borderLeft: `3px solid ${borderColor}`, display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>

                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--sp-tx1)' }}>{step.label}</span>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, fontFamily: 'monospace', color: borderColor }}>{step.count.toLocaleString()}</span>
                      <span style={{ fontSize: '0.55rem', color: 'var(--sp-txm)' }}>events</span>
                      {avgPerDay !== null && <span style={{ fontSize: '0.55rem', color: 'var(--sp-tx2)' }}>· ~{avgPerDay.toLocaleString()}/day</span>}
                    </div>

                    {/* Rate chips */}
                    {chips.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {chips.map(({ label, value, color }: RateChip) => (
                          <div key={label} style={{ flex: '1 1 130px', display: 'flex', flexDirection: 'column', gap: '0.1rem', padding: '0.38rem 0.55rem', background: 'var(--sp-s1)', borderRadius: '5px' }}>
                            <span style={{ fontSize: '0.5rem', color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1.35 }}>{label}</span>
                            <span style={{ fontSize: '0.92rem', fontWeight: 800, fontFamily: 'monospace', color }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Task Starts — intent by initial_build_started */}
                    {selectedStep === 'task_starts' && intentByBuildStarted.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.57rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>By Intent — initial_build_started</div>
                        <MiniBreakdown rows={intentByBuildStarted} total={intentByBuildStartedTotal} colors={INTENT_COLORS} />
                      </div>
                    )}

                    {/* Initial Build — intent by initial_build_completed */}
                    {selectedStep === 'initial_build' && intentByBuild.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.57rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>By Intent — initial_build_completed</div>
                        <MiniBreakdown rows={intentByBuild} total={intentByBuildTotal} colors={INTENT_COLORS} />
                      </div>
                    )}

                    {/* Publish Intent — note */}
                    {selectedStep === 'publish_intent' && (
                      <div style={{ fontSize: '0.57rem', color: 'var(--sp-txm)', padding: '0.3rem 0.5rem', background: 'var(--sp-s1)', borderRadius: '4px', lineHeight: 1.5 }}>
                        publish_attempt fires before the paywall check — users who hit the paywall are a subset of this count
                      </div>
                    )}

                    {/* Paywall Hit — banner contribution */}
                    {selectedStep === 'paywall_hit' && hasUpgradeBanner && (
                      <div>
                        <div style={{ fontSize: '0.57rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Upgrade Banner</div>
                        <MiniBreakdown
                          rows={[{ label: 'Impressions', count: bannerViews }, { label: 'Clicks', count: bannerClicks }, { label: 'Dismissed', count: bannerDismiss }].filter((r) => r.count > 0)}
                          total={bannerViews}
                          colors={['#6366f1', '#10b981', '#94a3b8']}
                        />
                        {bannerCtr !== null && (
                          <div style={{ fontSize: '0.57rem', color: 'var(--sp-tx2)', marginTop: '0.35rem' }}>
                            Banner CTR <span style={{ fontWeight: 700, color: '#6366f1' }}>{bannerCtr}%</span>
                            {bannerToPaywallPct !== null && <span> · <span style={{ fontWeight: 700, color: '#10b981' }}>{bannerToPaywallPct}%</span> of paywall views sourced via banner</span>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Purchase — plan mix + subscription vs credits */}
                    {selectedStep === 'purchase' && planMix.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                        <div>
                          <div style={{ fontSize: '0.57rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Plan Breakdown</div>
                          <MiniBreakdown rows={planMix} total={planTotal} colors={PLAN_COLORS} />
                        </div>
                        {subCount > 0 && creditsCount > 0 && (
                          <div>
                            <div style={{ fontSize: '0.57rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Subscriptions vs Credits</div>
                            <MiniBreakdown rows={[{ label: 'Subscriptions', count: subCount }, { label: 'Credits', count: creditsCount }]} total={planTotal} colors={['#0284c7', '#f59e0b']} />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Published — first vs re-publish (all mode) */}
                    {selectedStep === 'task_complete' && userMode === 'all' && firstPublishAll > 0 && (
                      <div>
                        <div style={{ fontSize: '0.57rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>First Publish vs Re-publish</div>
                        <MiniBreakdown
                          rows={[{ label: 'First publish', count: firstPublishAll }, { label: 'Re-publish', count: republishAll }].filter((r) => r.count > 0)}
                          total={allTaskComplete}
                          colors={['#059669', '#0284c7']}
                        />
                      </div>
                    )}

                  </div>
                );
              })()}
            </>
          )}
        </div>
      </Section>

      {/* Upgrade Touchpoints */}
      {(hasUpgradeBanner || hasD2p || hasPaymentSkill) && (
        <Section title="Upgrade Touchpoints" sub={`BMP · How users arrive at the paywall · last ${range}`}>
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>

            {hasUpgradeBanner && (
              <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Upgrade Banner</span>
                  <ScorecardHelpBadge info={{ what: 'In-product upgrade banner impressions and click-through rate — measures how effectively the banner drives users to the paywall.', how: 'upgrade_banner_view / upgrade_banner_click / upgrade_banner_dismiss · BMP paywall_conversion_events.', reading: 'Click rate = clicks ÷ views. High dismiss rate relative to clicks suggests banner copy or timing needs improvement.' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {[
                    { label: 'Views',   value: bannerViews,   color: '#6366f1' },
                    { label: 'Clicks',  value: bannerClicks,  color: '#10b981' },
                    { label: 'Dismissed', value: bannerDismiss, color: 'var(--sp-tx2)' },
                  ].map((row) => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>{row.label}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace', color: row.color }}>
                        {row.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {bannerCtr !== null && (
                    <div style={{ fontSize: '0.6rem', color: 'var(--sp-txm)', marginTop: '0.25rem' }}>
                      Click rate: {bannerCtr}%
                    </div>
                  )}
                </div>
              </div>
            )}

            {hasD2p && (
              <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>D2P Modal Flow</span>
                  <ScorecardHelpBadge info={{ what: 'Direct-to-purchase modal funnel — tracks users from modal impression through checkout initiation and errors.', how: 'd2p_modal_shown / d2p_checkout_start / d2p_checkout_error · BMP website_core_events.', reading: 'High checkout error rate relative to checkout starts indicates payment processing issues.' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {[
                    { label: 'Modal Shown',      value: rv.d2pModalShown,    color: '#6366f1' },
                    { label: 'Checkout Started', value: rv.d2pCheckoutStart, color: '#0284c7' },
                    { label: 'Checkout Errors',  value: rv.d2pCheckoutError, color: rv.d2pCheckoutError > 0 ? '#ef4444' : 'var(--sp-tx2)' },
                  ].map((row) => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>{row.label}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace', color: row.color }}>
                        {row.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasPaymentSkill && (
              <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Payment Skill</span>
                  <ScorecardHelpBadge info={{ what: 'AI-driven payment setup skill — tracks users who triggered in-chat payment intent through to a verified completed setup.', how: 'payment_intent_detected / payment_skill_invoked / payment_setup_started / payment_setup_completed / payment_setup_verified · BMP website_core_events.', reading: 'High intent with low completion suggests skill invocation or checkout friction. Conversion rate = completed ÷ started.' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {[
                    { label: 'Intent',    value: rv.paymentIntentDetected,  color: '#6366f1' },
                    { label: 'Invoked',   value: rv.paymentSkillInvoked,    color: '#0891b2' },
                    { label: 'Started',   value: rv.paymentSetupStarted,    color: '#0284c7' },
                    { label: 'Completed', value: rv.paymentSetupCompleted,  color: '#10b981' },
                    { label: 'Verified',  value: rv.paymentSetupVerified,   color: '#059669' },
                  ].map((row) => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.62rem', color: 'var(--sp-tx2)' }}>{row.label}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace', color: row.color }}>
                        {row.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {rv.paymentSetupConversionRate !== null && (
                    <div style={{ fontSize: '0.6rem', color: 'var(--sp-txm)', marginTop: '0.25rem' }}>
                      Setup conv. rate: {rv.paymentSetupConversionRate}%
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </Section>
      )}

      {/* Funnel Trend */}
      {trendPoints.length > 0 && (
        <Section title="Funnel Trend" sub={`BMP · Task Starts → Paywall → Purchases → Completions · ${vLabel}`}>
          <div style={{ ...CARD, padding: '0.75rem' }}>
            <IntervalChart
              data={trendPoints}
              series={trendSeries}
              size={chartSize}
              defaultType="line"
            />
          </div>
        </Section>
      )}

    </div>
  );
}
