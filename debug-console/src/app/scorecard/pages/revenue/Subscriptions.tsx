'use client';

import React, { useState } from 'react';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';

import { CARD, IntervalChart, ScorecardHelpBadge, Section, StatCard, cardGrid } from '../../components';
import type { IntervalDataPoint, IntervalSeries } from '../../components';
import { SkeletonCardGrid, SkeletonChart } from '../../components/Skeleton';
import { bmpVal } from '../../hooks/useBmpData';
import type { BmpInterval, BmpMetric, ScorecardBmpFeedbackData } from '../../hooks/useBmpData';
import { usePdnaAppsData } from '../../hooks/usePdnaAppsData';
import type { ScorecardChartSize, ScorecardRange, TrendView } from '../../types';
import { aggregateByView, viewLabel } from '../../trendAggregation';

function sumMetrics(metrics: BmpMetric[], name: string): number {
  return metrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, name), 0);
}

function buildPaywallTimeSeries(
  metrics: BmpMetric[],
  measures: { key: string; label: string; color: string }[],
): { points: IntervalDataPoint[]; series: IntervalSeries[] } {
  const dateMap = new Map<string, Map<string, number>>();
  for (const m of metrics) {
    for (const interval of (m.intervals ?? [] as BmpInterval[])) {
      const dateKey: string = (interval.startTime ?? '').slice(0, 10);
      if (!dateKey) continue;
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

const PDNA_PLAN_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'starter',      label: 'Starter',      color: '#0ea5e9' },
  { key: 'professional', label: 'Professional',  color: '#8b5cf6' },
  { key: 'ultimate',     label: 'Ultimate',      color: '#f59e0b' },
  { key: 'free',         label: 'Free',          color: '#34d399' },
];

const CHURN_TREND_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'purchase_success',  label: 'New Purchases',  color: '#10b981' },
  { key: 'plan_cancellation', label: 'Cancellations',  color: '#ef4444' },
];

interface Props {
  paywallData: ScorecardBmpFeedbackData | null;
  rawRange:    ScorecardRange;
  customFrom:  string;
  customTo:    string;
  chartSize:   ScorecardChartSize;
  trendView?:  TrendView;
  bmpLoading?: boolean;
}

export function RevenueSubscriptions({
  paywallData, rawRange, customFrom, customTo, chartSize, trendView = 'daily', bmpLoading = false,
}: Props): React.ReactElement {
  const { data: pdnaAppsResult, loading: pdnaLoading, stale: pdnaAppsStale, error: pdnaAppsError } =
    usePdnaAppsData(rawRange, customFrom, customTo);

  const pdnaApps = pdnaAppsResult && !pdnaAppsResult.configMissing ? pdnaAppsResult : null;

  const pwMetrics: BmpMetric[] = paywallData?.metrics ?? [];
  const hasBmpPaywall: boolean = !paywallData?.configMissing && pwMetrics.length > 0;

  const purchases:    number = hasBmpPaywall ? sumMetrics(pwMetrics, 'purchase_success')  : 0;
  const cancellations:number = hasBmpPaywall ? sumMetrics(pwMetrics, 'plan_cancellation') : 0;
  const downgrades:   number = hasBmpPaywall ? sumMetrics(pwMetrics, 'downgrade_scheduled') : 0;
  const suspended:    number = hasBmpPaywall ? sumMetrics(pwMetrics, 'suspended_nonpayment') : 0;
  const netNew:       number = purchases - cancellations;
  const churnRate:    number | null = purchases > 0 ? Math.round((cancellations / purchases) * 1000) / 10 : null;

  const bannerViews:      number = hasBmpPaywall ? sumMetrics(pwMetrics, 'upgrade_banner_view')    : 0;
  const bannerClicks:     number = hasBmpPaywall ? sumMetrics(pwMetrics, 'upgrade_banner_click')   : 0;
  const bannerDismiss:    number = hasBmpPaywall ? sumMetrics(pwMetrics, 'upgrade_banner_dismiss') : 0;
  const bannerCtr:        number | null = bannerViews > 0 ? Math.round((bannerClicks / bannerViews) * 1000) / 10 : null;
  const hasUpgradeBanner: boolean = bannerViews > 0;

  const bmpSource: string = hasBmpPaywall ? 'BMP · paywall_conversion_events' : 'BMP (not connected)';

  const rangeByPlan: Record<string, number> = pdnaApps
    ? pdnaApps.subscriptionsDailyByPlan.reduce(
        (acc: Record<string, number>, d) => {
          for (const [plan, count] of Object.entries(d.byPlan)) {
            acc[plan] = (acc[plan] ?? 0) + count;
          }
          return acc;
        },
        {},
      )
    : {};

  const rangeTotalSubs: number = pdnaApps
    ? pdnaApps.subscriptionsDaily.reduce((s, d) => s + d.subscriptions, 0)
    : 0;

  const paidSubs:  number = (rangeByPlan['starter'] ?? 0) + (rangeByPlan['professional'] ?? 0) + (rangeByPlan['ultimate'] ?? 0);
  const paidShare: number | null = rangeTotalSubs > 0 ? Math.round((paidSubs / rangeTotalSubs) * 100) : null;
  const numDays:   number = pdnaApps?.subscriptionsDaily.length ?? 0;
  const avgPerDay: number | null = numDays > 0 ? Math.round((rangeTotalSubs / numDays) * 10) / 10 : null;

  const vLabel: string = viewLabel(trendView);

  const { points: rawChurn, series: churnSeries } = buildPaywallTimeSeries(pwMetrics, CHURN_TREND_MEASURES);
  const churnTrendPoints: IntervalDataPoint[] = aggregateByView(
    rawChurn,
    CHURN_TREND_MEASURES.map((m) => m.key),
    trendView,
  );

  const pdnaPlanItems: { key: string; label: string; color: string; count: number }[] = PDNA_PLAN_MEASURES
    .map((m) => ({ ...m, count: rangeByPlan[m.key] ?? 0 }));

  const planDistRows: typeof pdnaPlanItems = pdnaPlanItems.filter((p) => p.count > 0);

  const [hiddenDist, setHiddenDist] = useState<Set<string>>(new Set<string>());
  const toggleDist = (name: string): void => {
    setHiddenDist((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const distPieData: { name: string; value: number; fill: string }[] = planDistRows
    .filter((m) => !hiddenDist.has(m.label))
    .map((m) => ({ name: m.label, value: m.count, fill: m.color }));

  const paidSharePoints: IntervalDataPoint[] = pdnaApps
    ? pdnaApps.subscriptionsDailyByPlan.map((r): IntervalDataPoint => {
        const paid: number = (r.byPlan['starter'] ?? 0) + (r.byPlan['professional'] ?? 0) + (r.byPlan['ultimate'] ?? 0);
        const total: number = paid + (r.byPlan['free'] ?? 0);
        return { label: r.date.slice(5), _date: r.date, paidShare: total > 0 ? Math.round((paid / total) * 100) : 0 };
      })
    : [];
  const paidShareSeries: IntervalSeries[] = [{ key: 'paidShare', label: 'Paid Share %', color: '#8b5cf6' }];

  const loading: boolean = pdnaLoading || bmpLoading;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <SkeletonCardGrid count={6} columns={`repeat(auto-fit, minmax(120px, 1fr))`} />
        <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : '1fr 1fr', gap: '0.9rem' }}>
          <SkeletonChart height="148px" />
          <SkeletonChart height="148px" />
        </div>
        <SkeletonCardGrid count={4} columns={`repeat(auto-fit, minmax(120px, 1fr))`} />
        <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : '1fr 1fr', gap: '0.9rem' }}>
          <SkeletonChart height="148px" />
          <SkeletonChart height="148px" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

      {/* Growth KPIs */}
      <Section title="Subscription Growth" sub={`PDNA · New subscriptions in range · ${pdnaAppsStale ? 'stale' : 'live'}`}>
        {pdnaApps ? (
          <>
            {pdnaAppsError && (
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.65rem', color: '#f59e0b' }}>Query warning: {pdnaAppsError}</p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
              <StatCard
                label="Total New Subs"
                value={rangeTotalSubs}
                description="All new subscriptions in range"
                accent="premium"
                help={{ what: 'New subscriptions created in the selected range.', how: 'Sum of subscriptionsDaily · PDNA ES.' }}
              />
              <StatCard
                label="New Starter"
                value={rangeByPlan['starter'] ?? 0}
                description="Starter plan new subs"
                accent="info"
                help={{ what: 'New Starter plan subscriptions.', how: 'subscriptionsDailyByPlan[starter] · PDNA ES.' }}
              />
              <StatCard
                label="New Professional"
                value={rangeByPlan['professional'] ?? 0}
                description="Professional plan new subs"
                accent="premium"
                help={{ what: 'New Professional plan subscriptions.', how: 'subscriptionsDailyByPlan[professional] · PDNA ES.' }}
              />
              <StatCard
                label="New Ultimate"
                value={rangeByPlan['ultimate'] ?? 0}
                description="Ultimate plan new subs"
                accent="premium"
                help={{ what: 'New Ultimate plan subscriptions.', how: 'subscriptionsDailyByPlan[ultimate] · PDNA ES.' }}
              />
              <StatCard
                label="New Free"
                value={rangeByPlan['free'] ?? 0}
                description="Free plan — upsell target pool"
                help={{ what: 'New free-plan users — the primary upsell target.', how: 'subscriptionsDailyByPlan[free] · PDNA ES.', reading: 'Large free count relative to paid indicates upsell opportunity.' }}
              />
              {paidShare !== null && (
                <StatCard
                  label="Paid Share"
                  value={`${paidShare}%`}
                  description="Starter + Pro + Ultimate ÷ total new subs"
                  accent="premium"
                  help={{ what: '% of new subscriptions in range that are paid plans (Starter, Professional, or Ultimate).', how: '(starter + professional + ultimate) ÷ total new subs · PDNA ES.', reading: 'Higher paid share = better upsell rate from free tier. Increasing this over time is a key growth indicator.' }}
                />
              )}
              {avgPerDay !== null && (
                <StatCard
                  label="Avg New Subs/Day"
                  value={avgPerDay}
                  description={`Average over ${numDays} days of data`}
                  help={{ what: 'Average number of new subscriptions created per day in the selected range.', how: 'Total new subs ÷ days with data · PDNA ES.', reading: 'Useful for spotting daily growth trends and velocity changes across date ranges.' }}
                />
              )}
              {hasBmpPaywall && (
                <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
                    <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Net New (Directional)</span>
                    <ScorecardHelpBadge info={{ what: 'Directional estimate of subscriber change: new purchases minus cancellations in the selected range.', how: 'purchase_success − plan_cancellation · BMP paywall_conversion_events.', reading: 'Positive = growing subscriber base. Negative = churn exceeds new acquisition. Directional only — does not account for renewals or billing-cycle timing.' }} />
                  </div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, fontFamily: 'monospace', lineHeight: 1, color: netNew >= 0 ? '#10b981' : '#ef4444' }}>
                    {netNew >= 0 ? '+' : ''}{netNew.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>Purchases − cancellations · BMP estimate</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)' }}>
            PDNA not connected — set PDNA_ES_ENDPOINT and PDNA_ES_API_KEY in .env.local
          </div>
        )}
      </Section>

      {/* Subscription Trend + Plan Mix */}
      {pdnaApps && (() => {
        const rawPts: IntervalDataPoint[] = pdnaApps.subscriptionsDailyByPlan
          .filter((r) => PDNA_PLAN_MEASURES.some(({ key }) => (r.byPlan[key] ?? 0) > 0))
          .map((r): IntervalDataPoint => {
            const pt: IntervalDataPoint = { label: r.date.slice(5), _date: r.date };
            for (const { key } of PDNA_PLAN_MEASURES) pt[key] = r.byPlan[key] ?? 0;
            return pt;
          });
        const pts: IntervalDataPoint[] = aggregateByView(rawPts, PDNA_PLAN_MEASURES.map((m) => m.key), trendView);
        const hasChart: boolean = pts.length > 0;
        const hasDist: boolean  = planDistRows.length > 0 && rangeTotalSubs > 0;

        if (!hasChart && !hasDist) return null;

        return (
          <div style={{ display: 'grid', gridTemplateColumns: hasChart && hasDist && chartSize !== 'full' ? '1fr 1fr' : '1fr', gap: '0.9rem' }}>
            {hasChart && (
              <Section title="Subscription Trend" sub={`PDNA · New subscriptions by plan · ${vLabel}`} style={{ height: '100%' }}>
                <div style={{ ...CARD, padding: '0.75rem', flex: 1 }}>
                  <IntervalChart data={pts} series={PDNA_PLAN_MEASURES} size={chartSize} defaultType="bar" />
                </div>
              </Section>
            )}
            {hasDist && (
              <Section title="Plan Mix" sub={`PDNA · Share of new subscriptions by tier · click to filter`} style={{ height: '100%' }}>
                <div style={{ ...CARD, padding: '0.75rem 1rem', flex: 1, display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flexShrink: 0 }}>
                    <PieChart width={chartSize === 'large' ? 170 : 130} height={chartSize === 'large' ? 170 : 130}>
                      <Pie
                        data={distPieData} dataKey="value" cx="50%" cy="50%"
                        innerRadius={chartSize === 'large' ? 50 : 38}
                        outerRadius={chartSize === 'large' ? 76 : 60}
                        paddingAngle={2} stroke="var(--sp-bg)" strokeWidth={2}
                      >
                        {distPieData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip
                        formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                        contentStyle={{ fontSize: '11px', background: '#151b24', border: '1px solid #252f3e', borderRadius: '6px', padding: '5px 9px' }}
                        itemStyle={{ color: '#f1f5f9', fontWeight: 600 }} labelStyle={{ color: '#a8b8cc' }} cursor={false}
                      />
                    </PieChart>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.45rem', minWidth: '120px' }}>
                    {planDistRows.map((m) => {
                      const pct: number = Math.round((m.count / rangeTotalSubs) * 100);
                      const isHidden: boolean = hiddenDist.has(m.label);
                      return (
                        <div
                          key={m.key}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleDist(m.label)}
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') toggleDist(m.label); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', opacity: isHidden ? 0.35 : 1, transition: 'opacity 0.15s' }}
                        >
                          <div style={{ width: 8, height: 8, borderRadius: '2px', background: m.color, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: '0.65rem', color: 'var(--sp-tx2)', textDecoration: isHidden ? 'line-through' : 'none' }}>{m.label}</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace' }}>{m.count.toLocaleString()}</span>
                          <span style={{ width: '30px', fontSize: '0.6rem', color: 'var(--sp-tx2)', textAlign: 'right' }}>{pct}%</span>
                        </div>
                      );
                    })}
                    {hiddenDist.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setHiddenDist(new Set<string>())}
                        style={{ fontSize: '0.54rem', color: 'var(--sp-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', marginTop: '0.1rem' }}
                      >
                        Show all
                      </button>
                    )}
                  </div>
                </div>
              </Section>
            )}
          </div>
        );
      })()}

      {/* Churn Signals */}
      {hasBmpPaywall && (
        <Section title="Churn Signals" sub={`${bmpSource} · Last ${rawRange}`}>
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
            <StatCard
              label="Cancellations"
              value={cancellations}
              description="plan_cancellation events"
              help={{ what: 'Plan cancellations initiated in range.', how: 'plan_cancellation · BMP paywall_conversion_events.', reading: 'Compare against new purchases for net churn.' }}
            />
            <StatCard
              label="Downgrades Scheduled"
              value={downgrades}
              description="downgrade_scheduled — leading churn"
              help={{ what: 'Users who scheduled a plan downgrade.', how: 'downgrade_scheduled · BMP paywall_conversion_events.', reading: 'Leading indicator — these users haven\'t cancelled yet but intend to reduce spend.' }}
            />
            <StatCard
              label="Suspended (Non-Pay)"
              value={suspended}
              description="suspended_nonpayment events"
              help={{ what: 'Accounts suspended for non-payment.', how: 'suspended_nonpayment · BMP paywall_conversion_events.', reading: 'High counts suggest billing collection issues.' }}
            />
            <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Churn Rate (Est.)</span>
                <ScorecardHelpBadge info={{ what: 'Rough churn rate: cancellations as a share of new purchases in the same range.', how: 'plan_cancellation ÷ purchase_success × 100 · BMP paywall_conversion_events.', reading: 'Directional only — not a true cohort churn rate. Green <10%, amber 10–20%, red >20%. High values suggest retention issues post-purchase.' }} />
              </div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, fontFamily: 'monospace', lineHeight: 1, color: churnRate === null ? 'var(--sp-tx2)' : churnRate > 20 ? '#ef4444' : churnRate > 10 ? '#f59e0b' : '#10b981' }}>
                {churnRate !== null ? `${churnRate}%` : '—'}
              </div>
              <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>Cancellations ÷ purchases</div>
            </div>
          </div>
        </Section>
      )}

      {/* Churn + Growth Trend  ·  Paid Share Over Time — side-by-side on s/l, stacked on full */}
      {(hasBmpPaywall && churnTrendPoints.length > 0) || paidSharePoints.length > 1 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: chartSize === 'full' ? '1fr' : '1fr 1fr',
          gap: '0.9rem',
        }}>
          {hasBmpPaywall && churnTrendPoints.length > 0 && (
            <Section
              title="Growth vs. Churn Trend"
              sub={`${bmpSource} · ${chartSize === 'small' ? 'New purchases · ' : 'New purchases + cancellations · '}${vLabel}`}
              style={{ height: '100%' }}
            >
              <div style={{ ...CARD, padding: '0.75rem', flex: 1 }}>
                <IntervalChart
                  data={churnTrendPoints}
                  series={chartSize === 'small' ? churnSeries.slice(0, 1) : churnSeries}
                  size={chartSize}
                  defaultType="line"
                />
              </div>
            </Section>
          )}
          {paidSharePoints.length > 1 && (
            <Section title="Paid Share Over Time" sub={`PDNA · % of daily new subscriptions that are paid plans · ${vLabel}`} style={{ height: '100%' }}>
              <div style={{ ...CARD, padding: '0.75rem', flex: 1 }}>
                <IntervalChart data={paidSharePoints} series={paidShareSeries} size={chartSize} defaultType="line" />
              </div>
            </Section>
          )}
        </div>
      ) : null}

      {/* Upgrade Banner Performance */}
      {hasUpgradeBanner && (
        <Section title="Upgrade Banner Performance" sub={`${bmpSource} · Banner impressions + engagement · last ${rawRange}`}>
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
            <StatCard
              label="Banner Views"
              value={bannerViews}
              description="upgrade_banner_view events"
              accent="info"
              help={{ what: 'Times the in-product upgrade banner was shown to users.', how: 'upgrade_banner_view · BMP paywall_conversion_events.' }}
            />
            <StatCard
              label="Banner Clicks"
              value={bannerClicks}
              description="Clicked through to upgrade"
              accent="premium"
              help={{ what: 'Users who clicked the upgrade banner, indicating purchase intent.', how: 'upgrade_banner_click · BMP paywall_conversion_events.', reading: 'Higher is better. Low clicks with high views = banner copy or placement issue.' }}
            />
            <StatCard
              label="Dismissed"
              value={bannerDismiss}
              description="Users who closed the banner"
              help={{ what: 'Users who dismissed the upgrade banner without clicking.', how: 'upgrade_banner_dismiss · BMP paywall_conversion_events.', reading: 'High dismiss rate relative to views indicates banner fatigue or poor timing/targeting.' }}
            />
            <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Banner CTR</span>
                <ScorecardHelpBadge info={{ what: '% of banner impressions that resulted in a click-through.', how: 'upgrade_banner_click ÷ upgrade_banner_view × 100 · BMP paywall_conversion_events.', reading: 'Aim for >5%. Low CTR with high views = messaging misalignment.' }} />
              </div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, fontFamily: 'monospace', lineHeight: 1, color: bannerCtr === null ? 'var(--sp-tx2)' : bannerCtr >= 10 ? '#10b981' : bannerCtr >= 5 ? '#f59e0b' : '#ef4444' }}>
                {bannerCtr !== null ? `${bannerCtr}%` : '—'}
              </div>
              <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>Clicks ÷ impressions</div>
            </div>
          </div>
        </Section>
      )}

    </div>
  );
}
