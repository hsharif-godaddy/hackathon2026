'use client';

import React, { useState } from 'react';

import {
  CARD, IntervalChart, Section, StatCard, SkeletonCardGrid, SkeletonChart,
} from '../components';
import type { IntervalDataPoint, IntervalSeries } from '../components';
import type { PdnaTlaFilter } from '../hooks/usePdnaData';
import { usePdnaAppsData } from '../hooks/usePdnaAppsData';
import type { PdnaAppsData } from '../hooks/usePdnaAppsData';
import { usePdnaAppsSnapshot } from '../hooks/usePdnaAppsSnapshot';
import type { PdnaAppsSnapshotData } from '../hooks/usePdnaAppsSnapshot';
import type { ScorecardChartSize, ScorecardRange, TrendView } from '../types';
import { aggregateByView } from '../trendAggregation';

const MONTH_NAMES: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtSnapshotDate(raw: string): string {
  const parts: string[] = raw.split('-');
  const year: number  = parseInt(parts[0] ?? '', 10);
  const mIdx: number  = parseInt(parts[1] ?? '', 10) - 1;
  const day: number   = parseInt(parts[2] ?? '', 10);
  if (isNaN(year) || isNaN(mIdx) || isNaN(day) || mIdx < 0 || mIdx > 11) return raw;
  return `${MONTH_NAMES[mIdx]} ${day}, ${year}`;
}

function fmtRangeLabel(range: string, customFrom: string, customTo: string): string {
  const MONTHS: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (range === 'custom' && customFrom && customTo) {
    const fmt = (d: string): string => {
      const parts: string[] = d.split('-');
      const mIdx: number    = parseInt(parts[1] ?? '', 10) - 1;
      const day: number     = parseInt(parts[2] ?? '', 10);
      return (mIdx >= 0 && mIdx < 12) ? `${MONTHS[mIdx]} ${day}` : d;
    };
    return `${fmt(customFrom)} – ${fmt(customTo)}`;
  }
  const LABELS: Record<string, string> = { '24h': 'last 24h', '7d': 'last 7 days', '14d': 'last 14 days', '30d': 'last 30 days', '90d': 'last 90 days' };
  return LABELS[range] ?? range;
}

function fmtHours(h: number | null): string {
  if (h === null) return '—';
  const hrs: number  = Math.floor(h);
  const mins: number = Math.round((h - hrs) * 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

const TLA_OPTIONS: Array<{ value: PdnaTlaFilter; label: string; title: string }> = [
  { value: 'all',     label: 'All',     title: 'All apps including internal tenants' },
  { value: 'non-tla', label: 'Non-TLA', title: 'Real customers only — excludes internal/test/marketing tenants' },
  { value: 'tla',     label: 'TLA',     title: 'Internal/test/marketing tenants only' },
];

const PLAN_OPTIONS = ['free', 'starter', 'professional', 'ultimate'] as const;
type PlanOption = (typeof PLAN_OPTIONS)[number];

const PLAN_COLORS: Record<string, string> = {
  free: '#94a3b8',
  starter: '#0284c7',
  professional: '#7c3aed',
  ultimate: '#0891b2',
};

const PLAN_SERIES: IntervalSeries[] = [
  { key: 'ultimate',     label: 'Ultimate',     color: PLAN_COLORS.ultimate },
  { key: 'professional', label: 'Professional', color: PLAN_COLORS.professional },
  { key: 'starter',      label: 'Starter',      color: PLAN_COLORS.starter },
  { key: 'free',         label: 'Free',         color: PLAN_COLORS.free },
];

const DUMMY_YMDS: readonly string[] = [
  '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28',
];
const DUMMY_BY_PLAN = { free: 0, starter: 0, professional: 0, ultimate: 0 };

const DUMMY_SNAPSHOT_DATA: PdnaAppsSnapshotData = {
  configMissing: false,
  snapshotDate: '—',
  totalApps: 0, publishedCount: 0, publishRate: 0,
  everPublishedCount: 0, everPublishedRate: 0,
  hibernatedCount: 0, hibernationRate: 0,
  deletedCount: 0, totalSubscriptions: 0,
  customDomainCount: 0, customDomainRate: 0,
  downgradesCount: 0, timeToPublishP50: null, timeToPublishP90: null,
};

const DUMMY_PDNA_APPS_DATA: PdnaAppsData = {
  configMissing: false,
  snapshotDate: '—',
  totalApps: 0, publishedCount: 0, publishRate: 0,
  everPublishedCount: 0, everPublishedRate: 0,
  hibernatedCount: 0, hibernationRate: 0,
  deletedCount: 0, totalSubscriptions: 0,
  customDomainCount: 0, customDomainRate: 0,
  downgradesCount: 0, timeToPublishP50: null, timeToPublishP90: null, timeToPublishP50Range: null, timeToPublishP90Range: null,
  appsCreatedDaily:          DUMMY_YMDS.map((date) => ({ date, created: 0 })),
  appsCreatedDailyByPlan:    DUMMY_YMDS.map((date) => ({ date, byPlan: DUMMY_BY_PLAN })),
  appsDeletedDaily:          DUMMY_YMDS.map((date) => ({ date, deleted: 0 })),
  everPublishedDaily:        DUMMY_YMDS.map((date) => ({ date, everPublished: 0 })),
  appsHibernatedDaily:       DUMMY_YMDS.map((date) => ({ date, hibernated: 0 })),
  appsCustomDomainDaily:     DUMMY_YMDS.map((date) => ({ date, customDomain: 0 })),
  uniqueCustomersDaily:      DUMMY_YMDS.map((date) => ({ date, uniqueCustomers: 0 })),
  subscriptionsDaily:        DUMMY_YMDS.map((date) => ({ date, subscriptions: 0 })),
  subscriptionsDailyByPlan:  DUMMY_YMDS.map((date) => ({ date, byPlan: DUMMY_BY_PLAN })),
  timeToPublishDaily:        DUMMY_YMDS.map((date) => ({ date, medianHours: 0 })),
  subscriptionPlans: {},
};

interface AppProvisioningProps {
  rawRange:   ScorecardRange;
  customFrom: string;
  customTo:   string;
  chartSize:  ScorecardChartSize;
  trendView?: TrendView;
}

export function AppProvisioning({ rawRange, customFrom, customTo, chartSize, trendView = 'daily' }: AppProvisioningProps) {
  const [tla, setTla]     = useState<PdnaTlaFilter>('non-tla');
  const [plans, setPlans] = useState<PlanOption[]>([]);

  const togglePlan = (p: PlanOption): void => {
    setPlans((prev: PlanOption[]) => prev.includes(p) ? prev.filter((x: PlanOption) => x !== p) : [...prev, p]);
  };

  // Snapshot: loads once on mount, independent of TLA/plan filters
  const { data: snapResult, loading: snapLoading } = usePdnaAppsSnapshot();
  // Range + Charts: re-fetches when TLA/plan/range changes
  const { data: rangeResult, loading: rangeLoading, stale: rangeStale, error: rangeError } = usePdnaAppsData(rawRange, customFrom, customTo, tla, plans);

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.55rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.08em',
  };

  const filterPillStyle = (active: boolean, color?: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: '6px', border: '1px solid transparent',
    cursor: 'pointer', fontSize: '11.5px', fontWeight: active ? 600 : 500,
    background: active ? (color ?? 'var(--sp-accent)') : 'var(--sp-s3)',
    color: active ? '#fff' : 'var(--sp-tx2)',
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.12s, color 0.12s',
  });

  const filterGroupStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '4px',
    background: 'var(--sp-s1)', border: '1px solid var(--sp-border)',
    borderRadius: '8px', padding: '4px 8px',
  };

  const filterLabelStyle: React.CSSProperties = {
    fontSize: '9.5px', fontWeight: 700, color: 'var(--sp-txm)',
    textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap',
  };

  const isSnapDummy: boolean  = !snapResult || snapResult.configMissing;
  const isRangeDummy: boolean = !rangeResult || rangeResult.configMissing;
  const snap: PdnaAppsSnapshotData = isSnapDummy ? DUMMY_SNAPSHOT_DATA : snapResult as PdnaAppsSnapshotData;
  const d: PdnaAppsData            = isRangeDummy ? DUMMY_PDNA_APPS_DATA : rangeResult as PdnaAppsData;

  const PLAN_KEYS: string[] = ['free', 'starter', 'professional', 'ultimate'];

  const createdByPlanPts: IntervalDataPoint[] = aggregateByView(
    d.appsCreatedDailyByPlan.map((r): IntervalDataPoint => ({
      label: r.date.slice(5), _date: r.date,
      free: r.byPlan['free'] ?? 0, starter: r.byPlan['starter'] ?? 0,
      professional: r.byPlan['professional'] ?? 0, ultimate: r.byPlan['ultimate'] ?? 0,
    })), PLAN_KEYS, trendView);

  const subsByPlanPts: IntervalDataPoint[] = aggregateByView(
    d.subscriptionsDailyByPlan.map((r): IntervalDataPoint => ({
      label: r.date.slice(5), _date: r.date,
      free: r.byPlan['free'] ?? 0, starter: r.byPlan['starter'] ?? 0,
      professional: r.byPlan['professional'] ?? 0, ultimate: r.byPlan['ultimate'] ?? 0,
    })), PLAN_KEYS, trendView);

  const everPubSeries: IntervalSeries[] = [{ key: 'everPublished', label: 'Ever Published', color: '#10b981' }];
  const everPubPts: IntervalDataPoint[] = aggregateByView(
    d.everPublishedDaily.map((r): IntervalDataPoint => ({ label: r.date.slice(5), _date: r.date, everPublished: r.everPublished })),
    ['everPublished'], trendView);

  const uniqueCustApprox: boolean = trendView !== 'daily';
  const uniqueCustSeries: IntervalSeries[] = [{ key: 'customers', label: 'Unique Customers', color: '#6366f1' }];
  const uniqueCustPts: IntervalDataPoint[] = aggregateByView(
    d.uniqueCustomersDaily.map((r): IntervalDataPoint => ({ label: r.date.slice(5), _date: r.date, customers: r.uniqueCustomers })),
    ['customers'], trendView);

  const ttpSeries: IntervalSeries[] = [{ key: 'medianHours', label: 'Median Hours', color: '#f59e0b' }];
  const ttpPts: IntervalDataPoint[] = (() => {
    const raw: IntervalDataPoint[] = d.timeToPublishDaily.map((r): IntervalDataPoint => ({
      label: r.date.slice(5), _date: r.date,
      medianHours: Math.round(r.medianHours * 10) / 10, _count: 1,
    }));
    const agg = aggregateByView(raw, ['medianHours', '_count'], trendView);
    return agg.map((pt): IntervalDataPoint => ({
      ...pt,
      medianHours: (pt._count as number) > 0
        ? Math.round(((pt.medianHours as number) / (pt._count as number)) * 10) / 10
        : 0,
    }));
  })();

  const deletedSeries: IntervalSeries[] = [{ key: 'deleted', label: 'Deleted', color: '#ef4444' }];
  const deletedPts: IntervalDataPoint[] = aggregateByView(
    d.appsDeletedDaily.map((r): IntervalDataPoint => ({ label: r.date.slice(5), _date: r.date, deleted: r.deleted })),
    ['deleted'], trendView);

  const totalCreated:  number = d.appsCreatedDaily.reduce((s, r) => s + r.created, 0);
  const totalEverPub:  number = d.everPublishedDaily.reduce((s, r) => s + r.everPublished, 0);
  const totalUniqCust: number = d.uniqueCustomersDaily.reduce((s, r) => s + r.uniqueCustomers, 0);
  const totalSubs:     number = d.subscriptionsDaily.reduce((s, r) => s + r.subscriptions, 0);
  const totalDeleted:  number = d.appsDeletedDaily.reduce((s, r) => s + r.deleted, 0);

  const chartCols: React.CSSProperties = chartSize === 'full'
    ? { gridTemplateColumns: '1fr' }
    : chartSize === 'large'
      ? { gridTemplateColumns: 'repeat(2, 1fr)' }
      : { gridTemplateColumns: 'repeat(4, 1fr)' };

  const chartSkeletonCount: number = chartSize === 'full' ? 1 : chartSize === 'large' ? 2 : 4;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── 1. Snapshot Summary — all-time, never re-fetches on filter change ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span style={sectionLabelStyle}>Snapshot Summary</span>
        {!isSnapDummy && snap.snapshotDate && snap.snapshotDate !== '—' && (
          <span style={{ fontSize: '0.55rem', color: 'var(--sp-txm)' }}>
            till {fmtSnapshotDate(snap.snapshotDate)}
          </span>
        )}
      </div>

      {(snapLoading && !snapResult) ? (
        <SkeletonCardGrid count={8} columns="repeat(auto-fit, minmax(120px, 1fr))" />
      ) : (
        <>
          {isSnapDummy && !snapLoading && (
            <div style={{ fontSize: '0.6rem', color: 'var(--sp-warning)', background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: '6px', padding: '0.3rem 0.6rem', display: 'inline-block', alignSelf: 'flex-start' }}>
              ⚠ PDNA not configured — set PDNA_ES_ENDPOINT + PDNA_ES_API_KEY · preview layout with no data
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', opacity: isSnapDummy ? 0.45 : 1 }}>
            <StatCard label="Total Apps"          value={snap.totalApps}            description={`Snapshot · ${snap.snapshotDate}`}                    help={{ what: 'Total number of Airo Builder apps that exist in PDNA as of the snapshot date — includes all states (live, hibernated, deleted).', how: 'PDNA provisioning snapshot. Reflects current state, not range-filtered.', reading: 'A baseline count. Compare week-over-week to track growth.' }} />
            <StatCard label="Published (Live)"    value={snap.publishedCount}       description={`${snap.publishRate}% of total`}            accent="info"    help={{ what: 'Apps that are currently live — published and not hibernated or deleted.', how: 'PDNA · apps with an active published state at snapshot time.', reading: 'High live rate means users are keeping their apps active. Low rate relative to Ever Published may signal hibernation or churn.' }} />
            <StatCard label="Ever Published"      value={snap.everPublishedCount}   description={`${snap.everPublishedRate}% of total`}       accent="info"    help={{ what: 'Apps that have been published at least once — includes currently live, hibernated, and deleted apps.', how: 'PDNA · apps where first_publish_utc_ts is set.', reading: 'The most meaningful completion signal. Compare to Total Apps to see what fraction of users reached their first publish.' }} />
            <StatCard label="Hibernated"          value={snap.hibernatedCount}      description={`${snap.hibernationRate}% of total`}                         help={{ what: 'Apps that have been put into hibernation — typically due to subscription downgrade or inactivity.', how: 'PDNA · apps with hibernation_utc_ts set and no subsequent reactivation.', reading: 'Rising hibernation rate can signal churn risk or plan-downgrade patterns.' }} />
            <StatCard label="Deleted"             value={snap.deletedCount}         description="app_delete_utc_ts set"                                     help={{ what: 'Apps explicitly deleted by the user or via admin action.', how: 'PDNA · apps where app_delete_utc_ts is set.', reading: 'Spike in deletions may correlate with a bad release or UX regression. Cross-reference with feedback score.' }} />
            <StatCard label="Custom Domain"       value={snap.customDomainCount}    description={`${snap.customDomainRate}% have custom domain`} accent="premium" help={{ what: 'Apps with a custom domain connected — a strong signal of user intent to go live with a real presence.', how: 'PDNA · apps where a custom domain record is set.', reading: 'Custom domain attachment correlates strongly with paid plan conversion and long-term retention.' }} />
            <StatCard label="Subscriptions"       value={snap.totalSubscriptions}   description="Unique subscription IDs"                  accent="premium" help={{ what: 'Total number of unique paid subscription IDs across all apps in PDNA — the authoritative KR1 source.', how: 'PDNA · count of distinct subscription_id values. This is the source of truth for paid units, more reliable than BMP purchase events.', reading: 'Target: 1000/day (KR1). Use the day-wise chart below to track growth trend.' }} />
            <StatCard label="P50 Time-to-Publish" value={fmtHours(snap.timeToPublishP50)} description="Median · creation → first publish (all-time)" help={{ what: 'Median time from app creation to first successful publish across all apps in the PDNA snapshot.', how: 'PDNA · P50 of (first_publish_utc_ts − created_utc_ts) in hours — all-time snapshot.', reading: 'Lower is better. Rising P50 may indicate UX friction in the build or publish flow.' }} />
            <StatCard label="P90 Time-to-Publish" value={fmtHours(snap.timeToPublishP90)} description="90th pct · creation → first publish (all-time)" help={{ what: '90th percentile time from app creation to first publish — all-time snapshot, shows the long-tail experience.', how: 'PDNA · P90 of (first_publish_utc_ts − created_utc_ts) in hours — all-time snapshot.', reading: 'A high P90 relative to P50 means a segment of users is taking much longer.' }} />
          </div>
        </>
      )}

      {/* ── 2. Filters — below snapshot, affect only range section ── */}
      <div style={{ borderTop: '1px solid var(--sp-border)', paddingTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={filterGroupStyle}>
            <span style={filterLabelStyle}>Audience</span>
            {TLA_OPTIONS.map(({ value, label, title }) => (
              <button key={value} type="button" title={title} onClick={() => setTla(value)} style={filterPillStyle(tla === value)}>
                {label}
              </button>
            ))}
          </div>
          <div style={filterGroupStyle}>
            <span style={filterLabelStyle}>Plan</span>
            <button type="button" onClick={() => setPlans([])} style={filterPillStyle(plans.length === 0)}>All</button>
            {PLAN_OPTIONS.map((p: PlanOption) => (
              <button key={p} type="button" onClick={() => togglePlan(p)} style={filterPillStyle(plans.includes(p), PLAN_COLORS[p])}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3. Range Summary + Charts — re-fetches on filter/range change ── */}
      {(rangeLoading && !rangeResult) || rangeStale ? (
        <>
          <SkeletonCardGrid count={7} columns="repeat(auto-fit, minmax(120px, 1fr))" />
          <div style={{ display: 'grid', ...chartCols, gap: '0.9rem' }}>
            {Array.from({ length: chartSkeletonCount + Math.min(2, chartSkeletonCount) }).map((_, i) => (
              <SkeletonChart key={i} height="148px" />
            ))}
          </div>
        </>
      ) : (
        <>
          {rangeError && (
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.65rem', color: '#f59e0b' }}>Query warning: {rangeError}</p>
          )}
          {!isRangeDummy && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={sectionLabelStyle}>Range Summary</span>
                <span style={{ fontSize: '0.55rem', color: 'var(--sp-txm)' }}>{fmtRangeLabel(rawRange, customFrom, customTo)}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
                <StatCard label="Apps Created"        value={totalCreated}   description="Created in range"              help={{ what: 'New apps created within the selected date range.', how: 'PDNA · sum of apps_created_daily buckets filtered to range.', reading: 'Track day-over-day growth. A spike may indicate a campaign or viral moment.' }} />
                <StatCard label="Subscriptions"       value={totalSubs}      description="New activations in range"      accent="premium" help={{ what: 'New paid subscription activations recorded in PDNA within the selected date range.', how: 'PDNA · sum of subscriptions_daily buckets filtered to range.', reading: 'Target: 1000/day (KR1). Compare to total snapshot count for growth rate.' }} />
                <StatCard label="Ever Published"      value={totalEverPub}   description="Reached first publish in range" accent="info"   help={{ what: 'Apps that reached their first publish within the selected range — by creation date cohort.', how: 'PDNA · sum of ever_published_daily buckets filtered to range.', reading: 'Compare to Apps Created in the same range for a range-level publish completion rate.' }} />
                <StatCard label="Unique Customers"    value={totalUniqCust}  description="Distinct customer IDs in range" help={{ what: 'Distinct customer IDs that have apps with creation dates in the selected range.', how: 'PDNA · sum of unique_customers_daily buckets filtered to range.', reading: 'Closer to real new-user count than app count when customers create multiple apps.' }} />
                <StatCard label="Apps Deleted"        value={totalDeleted}   description="Deleted in range"              help={{ what: 'Apps explicitly deleted within the selected range.', how: 'PDNA · sum of apps_deleted_daily buckets filtered to range.', reading: 'Spike in deletions may correlate with a bad release or UX regression.' }} />
                <StatCard label="P50 Time-to-Publish" value={fmtHours(d.timeToPublishP50Range)} description="Median · apps created in range" help={{ what: 'Median time from creation to first publish for apps created within the selected range.', how: 'PDNA · P50 percentile aggregation filtered to app_create_utc_ts in range.', reading: 'Lower is better. Compare to all-time P50 above to see if recent cohorts are faster or slower.' }} />
                <StatCard label="P90 Time-to-Publish" value={fmtHours(d.timeToPublishP90Range)} description="90th pct · apps created in range" help={{ what: '90th percentile time from creation to first publish for apps created within the selected range.', how: 'PDNA · P90 percentile aggregation filtered to app_create_utc_ts in range.', reading: 'Compare to all-time P90 above. A rising P90 signals growing long-tail friction.' }} />
              </div>
            </>
          )}

          <div style={{ borderTop: '1px solid var(--sp-border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
            <span style={sectionLabelStyle}>Day-wise Trends</span>
          </div>

          <div style={{ display: 'grid', ...chartCols, gap: '0.9rem', alignItems: 'start', opacity: isRangeDummy ? 0.45 : 1 }}>
            {createdByPlanPts.length > 0 && (
              <Section title={`Apps Created · ${totalCreated.toLocaleString()}`} sub="PDNA · By creation date, stacked by plan">
                <div style={{ ...CARD, padding: '0.75rem' }}>
                  <IntervalChart data={createdByPlanPts} series={PLAN_SERIES} size={chartSize} defaultType="bar" />
                </div>
              </Section>
            )}
            {subsByPlanPts.length > 0 && (
              <Section title={`Subscriptions · ${totalSubs.toLocaleString()}`} sub="PDNA · New activations by day, stacked by plan">
                <div style={{ ...CARD, padding: '0.75rem' }}>
                  <IntervalChart data={subsByPlanPts} series={PLAN_SERIES} size={chartSize} defaultType="bar" />
                </div>
              </Section>
            )}
            {everPubPts.length > 0 && (
              <Section title={`Ever Published · ${totalEverPub.toLocaleString()}`} sub="PDNA · Apps that reached first publish">
                <div style={{ ...CARD, padding: '0.75rem' }}>
                  <IntervalChart data={everPubPts} series={everPubSeries} size={chartSize} defaultType="bar" />
                </div>
              </Section>
            )}
            {uniqueCustPts.length > 0 && (
              <Section
                title={`Unique Customers · ${totalUniqCust.toLocaleString()}`}
                sub={uniqueCustApprox ? 'PDNA · summed daily distinct counts — customers active across multiple days are counted more than once' : 'PDNA · Distinct customer IDs with apps'}
              >
                <div style={{ ...CARD, padding: '0.75rem' }}>
                  <IntervalChart data={uniqueCustPts} series={uniqueCustSeries} size={chartSize} defaultType="bar" />
                </div>
              </Section>
            )}
            {ttpPts.length > 0 && (
              <Section title="Median Time-to-Publish (h)" sub="PDNA · P50 hours from creation to first publish">
                <div style={{ ...CARD, padding: '0.75rem' }}>
                  <IntervalChart data={ttpPts} series={ttpSeries} size={chartSize} defaultType="line" />
                </div>
              </Section>
            )}
            {deletedPts.length > 0 && (isRangeDummy || totalDeleted > 0) && (
              <Section title={`Apps Deleted · ${totalDeleted.toLocaleString()}`} sub="PDNA · By deletion date">
                <div style={{ ...CARD, padding: '0.75rem' }}>
                  <IntervalChart data={deletedPts} series={deletedSeries} size={chartSize} defaultType="bar" />
                </div>
              </Section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
