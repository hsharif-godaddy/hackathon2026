'use client';

import React, { useState } from 'react';
import { Cell, Pie, PieChart, Tooltip } from 'recharts';

import { CARD, IntervalChart, MetricCard, ScorecardHelpBadge, Section, StatCard, cardGrid } from '../../components';
import type { IntervalDataPoint, IntervalSeries, ScorecardHelpInfo } from '../../components';
import { SkeletonCardGrid, SkeletonChart } from '../../components/Skeleton';
import { bmpVal } from '../../hooks/useBmpData';
import type { BmpInterval, BmpMetric, ScorecardBmpFeedbackData } from '../../hooks/useBmpData';
import type { ScorecardChartSize, ScorecardData, TrendView } from '../../types';
import { aggregateByView, computePeriodDelta, viewLabel } from '../../trendAggregation';
import type { PeriodDelta } from '../../trendAggregation';

const KR1_TARGET = 1_000;

const TREND_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'paywall_view',     label: 'Paywall Views', color: '#6366f1' },
  { key: 'purchase_success', label: 'Purchases',     color: '#10b981' },
];

const PLAN_ITEMS: { key: string; label: string; color: string }[] = [
  { key: 'purchase_starter',      label: 'Starter',       color: '#0284c7' },
  { key: 'purchase_professional', label: 'Professional',  color: '#7c3aed' },
  { key: 'purchase_ultimate',     label: 'Ultimate',      color: '#0891b2' },
  { key: 'credits_purchase',      label: 'Credits Bought',color: '#f59e0b' },
];

function sumMetrics(metrics: BmpMetric[], name: string): number {
  return metrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, name), 0);
}

function buildTimeSeries(
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

function DeltaBadge({ delta }: { delta: PeriodDelta }): React.ReactElement | null {
  const { deltaPct } = delta;
  if (deltaPct === null) return null;
  const up: boolean = deltaPct >= 0;
  return (
    <span style={{
      display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, lineHeight: 1,
      color: up ? '#10b981' : '#ef4444',
      background: up ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
      padding: '0.06rem 0.32rem', borderRadius: '8px',
    }}>
      {up ? '▲' : '▼'} {Math.abs(deltaPct)}%
    </span>
  );
}

interface KpiCardProps {
  label:       string;
  value:       number | string;
  description: string;
  delta?:      PeriodDelta;
  color?:      string;
  help?:       ScorecardHelpInfo;
}

function KpiCard({ label, value, description, delta, color, help }: KpiCardProps): React.ReactElement {
  return (
    <div style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {label}
        </span>
        {help && <ScorecardHelpBadge info={help} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '1.35rem', fontWeight: 800, fontFamily: 'monospace', lineHeight: 1,
          color: color ?? 'var(--sp-tx1)',
        }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {delta && <DeltaBadge delta={delta} />}
      </div>
      <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{description}</div>
    </div>
  );
}

interface Props {
  data:        ScorecardData;
  paywallData: ScorecardBmpFeedbackData | null;
  range:       string;
  chartSize:   ScorecardChartSize;
  trendView?:  TrendView;
  bmpLoading?: boolean;
}

export function RevenueOverview({ data, paywallData, range, chartSize, trendView = 'daily', bmpLoading = false }: Props): React.ReactElement {
  const rv = data.revenue;
  const pwMetrics: BmpMetric[] = paywallData?.metrics ?? [];
  const hasBmp: boolean = !paywallData?.configMissing && pwMetrics.length > 0;

  const paywallViews:    number = hasBmp ? sumMetrics(pwMetrics, 'paywall_view')          : rv.paywallViews;
  const purchases:       number = hasBmp ? sumMetrics(pwMetrics, 'purchase_success')      : rv.purchases;
  const purchaseStarter: number = hasBmp ? sumMetrics(pwMetrics, 'purchase_starter')      : rv.purchaseStarter;
  const purchasePro:     number = hasBmp ? sumMetrics(pwMetrics, 'purchase_professional') : rv.purchasePro;
  const purchaseUltimate:number = hasBmp ? sumMetrics(pwMetrics, 'purchase_ultimate')     : rv.purchaseUltimate;
  const creditsPurchase: number = hasBmp ? sumMetrics(pwMetrics, 'credits_purchase')      : rv.creditPurchaseSuccess;
  const convRate: number | null = paywallViews > 0 ? Math.round((purchases / paywallViews) * 1000) / 10 : null;

  const deltaViews:     PeriodDelta = computePeriodDelta(pwMetrics, 'paywall_view');
  const deltaPurchases: PeriodDelta = computePeriodDelta(pwMetrics, 'purchase_success');

  const kr1Pct: number   = Math.min(Math.round((rv.paidUnitsToday / KR1_TARGET) * 100), 100);
  const kr1Color: string = kr1Pct >= 100 ? '#10b981' : kr1Pct >= 70 ? '#f59e0b' : '#ef4444';

  const bmpSource: string = hasBmp ? 'BMP · paywall_conversion_events' : 'PDNA (BMP pending)';

  const { points: rawTrend, series: trendSeries } = buildTimeSeries(pwMetrics, TREND_MEASURES);
  const trendPoints: IntervalDataPoint[] = aggregateByView(rawTrend, TREND_MEASURES.map((m) => m.key), trendView);
  const vLabel: string = viewLabel(trendView);

  const { points: rawTierTrend } = buildTimeSeries(pwMetrics, PLAN_ITEMS);
  const tierTrendPoints: IntervalDataPoint[] = aggregateByView(rawTierTrend, PLAN_ITEMS.map((m: { key: string }) => m.key), trendView);
  const tierTrendSeries: IntervalSeries[] = PLAN_ITEMS.map(({ key, label, color }): IntervalSeries => ({ key, label, color }));

  const numDays:     number = rawTrend.length;
  const avgViewsDay: number | null = hasBmp && numDays > 0 && paywallViews > 0 ? Math.round(paywallViews / numDays) : null;
  const avgPurchDay: number | null = hasBmp && numDays > 0 && purchases > 0    ? Math.round(purchases / numDays)    : null;

  const planCounts: { key: string; label: string; color: string; count: number }[] = [
    { ...PLAN_ITEMS[0]!, count: purchaseStarter  },
    { ...PLAN_ITEMS[1]!, count: purchasePro      },
    { ...PLAN_ITEMS[2]!, count: purchaseUltimate },
    { ...PLAN_ITEMS[3]!, count: creditsPurchase  },
  ];
  const planTotal: number = planCounts.reduce((s, p) => s + p.count, 0);
  const [hiddenPlans, setHiddenPlans] = useState<Set<string>>(new Set<string>());
  const togglePlan = (name: string): void => {
    setHiddenPlans((prev: Set<string>) => {
      const next: Set<string> = new Set<string>(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const planPieData: { name: string; value: number; fill: string }[] = planCounts
    .filter((i) => i.count > 0 && !hiddenPlans.has(i.label))
    .map((i) => ({ name: i.label, value: i.count, fill: i.color }));

  const cancellations:  number = hasBmp ? sumMetrics(pwMetrics, 'plan_cancellation')      : 0;
  const downgrades:     number = hasBmp ? sumMetrics(pwMetrics, 'downgrade_scheduled')    : 0;
  const suspended:      number = hasBmp ? sumMetrics(pwMetrics, 'suspended_nonpayment')   : 0;
  const netNew:         number = purchases - cancellations;
  const churnRate:      number | null = purchases > 0 ? Math.round((cancellations / purchases) * 1000) / 10 : null;

  const bannerViews:   number = hasBmp ? sumMetrics(pwMetrics, 'upgrade_banner_view')    : 0;
  const bannerClicks:  number = hasBmp ? sumMetrics(pwMetrics, 'upgrade_banner_click')   : 0;
  const bannerDismiss: number = hasBmp ? sumMetrics(pwMetrics, 'upgrade_banner_dismiss') : 0;
  const bannerCtr:     number | null = bannerViews > 0 ? Math.round((bannerClicks / bannerViews) * 1000) / 10 : null;

  const convRateColor: string = convRate === null
    ? 'var(--sp-tx2)'
    : convRate >= 10 ? '#10b981' : convRate >= 5 ? '#f59e0b' : '#ef4444';

  if (bmpLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <SkeletonCardGrid count={6} columns={`repeat(auto-fit, minmax(120px, 1fr))`} />
        <SkeletonChart height="148px" />
        <SkeletonChart height="148px" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>

      {/* KR1 Progress */}
      <Section title="KR1 — Daily Paid Units Target" sub={`${rv.paidUnitsToday.toLocaleString()} paid units today · target: ${KR1_TARGET.toLocaleString()}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ flex: 1, height: '24px', background: 'var(--sp-s3)', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
              <div style={{
                width: `${kr1Pct}%`, height: '100%',
                background: kr1Pct >= 100
                  ? 'linear-gradient(90deg, #059669, #10b981)'
                  : kr1Pct >= 70
                    ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                    : 'linear-gradient(90deg, #dc2626, #ef4444)',
                borderRadius: '8px',
                transition: 'width 0.7s ease',
              }} />
            </div>
            <span style={{
              fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace', color: kr1Color,
              flexShrink: 0, minWidth: '52px', textAlign: 'right',
            }}>
              {kr1Pct}%
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--sp-txm)' }}>
            <span>{rv.paidUnitsToday.toLocaleString()} units today</span>
            <span>Target: {KR1_TARGET.toLocaleString()}</span>
          </div>
        </div>
      </Section>

      {/* KPI Cards */}
      <Section title="Revenue KPIs" sub={`${bmpSource} · last ${range}`}>
        <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
          <StatCard
            label="Paid Units (Today)"
            value={rv.paidUnitsToday}
            description="Latest day — new + renewals"
            accent="premium"
            help={{ what: 'Paid units on the most recent day in the range.', how: 'Latest day bucket from PDNA ES subscriptionsDailyByPlan.' }}
          />
          <StatCard
            label="Paid Units (Range)"
            value={rv.paidUnitsInRange}
            description={`New + renewals · last ${range}`}
            accent="premium"
            help={{ what: 'Total paid units including new purchases and renewals in range.', how: 'subscriptionsDailyByPlan · PDNA ES.' }}
          />
          <KpiCard
            label="Paywall Views"
            value={paywallViews}
            description="Users who saw the upgrade paywall"
            delta={deltaViews}
            help={{ what: 'Users who were shown the upgrade/purchase paywall in the selected range.', how: 'paywall_view · BMP paywall_conversion_events.', reading: 'High views with low purchases = conversion problem. Low views = not enough users reaching the paywall.' }}
          />
          <KpiCard
            label="New Purchases"
            value={purchases}
            description="New plan purchases in range"
            delta={deltaPurchases}
            help={{ what: 'New plan purchases (Starter, Professional, Ultimate) completed in the range.', how: 'purchase_success · BMP paywall_conversion_events.', reading: 'The primary revenue signal. ▲/▼ badge shows trend vs. first half of range.' }}
          />
          <KpiCard
            label="Conversion Rate"
            value={convRate !== null ? `${convRate}%` : '—'}
            description="Purchases ÷ paywall views"
            color={convRateColor}
            help={{ what: '% of paywall views that resulted in a completed purchase.', how: 'purchase_success ÷ paywall_view × 100 · BMP paywall_conversion_events.', reading: 'Target ≥10%. Green ≥10%, amber ≥5%, red <5%. Low rate = checkout friction or plan pricing issue.' }}
          />
          <MetricCard
            label="Purchase Conv. Rate"
            metric={{ rate: convRate !== null ? Math.round(convRate) : null, numerator: purchases, denominator: paywallViews }}
            description="Purchases ÷ paywall views"
            green={10} amber={5}
            help={{ what: '% of users who saw the paywall and completed a purchase.', how: 'purchase_success ÷ paywall_view · BMP paywall_conversion_events.', reading: 'Target ≥10%.' }}
          />
          {bannerViews > 0 && (
            <KpiCard
              label="Banner Views"
              value={bannerViews}
              description="upgrade_banner_view events"
              help={{ what: 'Number of times the in-product upgrade banner was shown to users.', how: 'upgrade_banner_view · BMP paywall_conversion_events.' }}
            />
          )}
          {bannerViews > 0 && (
            <KpiCard
              label="Banner CTR"
              value={bannerCtr !== null ? `${bannerCtr}%` : '—'}
              description={`${bannerClicks.toLocaleString()} clicks · ${bannerDismiss.toLocaleString()} dismissed`}
              color={bannerCtr !== null ? (bannerCtr >= 10 ? '#10b981' : bannerCtr >= 5 ? '#f59e0b' : '#ef4444') : undefined}
              help={{ what: '% of banner impressions that resulted in a click-through to the paywall.', how: 'upgrade_banner_click ÷ upgrade_banner_view × 100 · BMP paywall_conversion_events.', reading: 'High dismiss rate relative to clicks suggests banner copy or timing needs improvement.' }}
            />
          )}
          {avgViewsDay !== null && (
            <KpiCard
              label="Avg Views/Day"
              value={avgViewsDay}
              description={`Paywall views · avg over ${numDays} days`}
              help={{ what: 'Average number of paywall views per day in the selected range.', how: 'Total paywall_view ÷ days with BMP data · paywall_conversion_events.', reading: 'Declining daily views may indicate fewer users reaching the funnel. Compare across date ranges to spot trends.' }}
            />
          )}
          {avgPurchDay !== null && (
            <KpiCard
              label="Avg Purchases/Day"
              value={avgPurchDay}
              description={`New purchases · avg over ${numDays} days`}
              help={{ what: 'Average number of new purchases per day in the selected range.', how: 'Total purchase_success ÷ days with BMP data · paywall_conversion_events.', reading: 'Core revenue velocity metric. Sudden drops are an immediate signal to investigate funnel health.' }}
            />
          )}
        </div>
      </Section>

      {/* Churn Signals */}
      {hasBmp && (cancellations + downgrades + suspended) > 0 && (
        <Section title="Churn Signals" sub={`${bmpSource} · Cancellations + downgrades · last ${range}`}>
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
            {[
              {
                label: 'Net New (Est.)', value: `${netNew >= 0 ? '+' : ''}${netNew.toLocaleString()}`,
                color: netNew >= 0 ? '#10b981' : '#ef4444',
                desc: 'Purchases − cancellations',
                help: { what: 'Directional estimate of subscriber growth: new purchases minus cancellations in the range.', how: 'purchase_success − plan_cancellation · BMP paywall_conversion_events.', reading: 'Positive = growing subscriber base. Negative = churn exceeds acquisition. Directional only — does not account for renewals or billing-cycle timing.' },
              },
              {
                label: 'Cancellations', value: cancellations.toLocaleString(),
                color: cancellations > 0 ? '#ef4444' : 'var(--sp-tx1)',
                desc: 'plan_cancellation events',
                help: { what: 'Plan cancellations initiated by users in the selected range.', how: 'plan_cancellation · BMP paywall_conversion_events.', reading: 'Compare against new purchases to assess net churn. A spike here without a corresponding purchase drop indicates a specific cohort issue.' },
              },
              {
                label: 'Downgrades Sched.', value: downgrades.toLocaleString(),
                color: downgrades > 0 ? '#f59e0b' : 'var(--sp-tx1)',
                desc: 'downgrade_scheduled · leading churn signal',
                help: { what: 'Users who scheduled a plan downgrade — they have not cancelled yet but intend to reduce spend.', how: 'downgrade_scheduled · BMP paywall_conversion_events.', reading: 'Leading indicator: monitor weekly. A rising count predicts future cancellations 1–2 billing cycles out.' },
              },
              {
                label: 'Churn Rate (Est.)', value: churnRate !== null ? `${churnRate}%` : '—',
                color: churnRate === null ? 'var(--sp-tx2)' : churnRate > 20 ? '#ef4444' : churnRate > 10 ? '#f59e0b' : '#10b981',
                desc: 'Cancellations ÷ purchases · directional',
                help: { what: 'Rough churn rate: cancellations as a share of purchases in the same range.', how: 'plan_cancellation ÷ purchase_success × 100 · BMP paywall_conversion_events.', reading: 'Directional only — not a true cohort churn rate. Green <10%, amber 10–20%, red >20%.' },
              },
            ].map((item) => (
              <div key={item.label} style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.2rem' }}>
                  <span style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--sp-txm)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{item.label}</span>
                  <ScorecardHelpBadge info={item.help} />
                </div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, fontFamily: 'monospace', lineHeight: 1, color: item.color }}>{item.value}</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)' }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Purchase Trend + Plan Mix — side-by-side on s/l, stacked on full */}
      {((hasBmp && trendPoints.length > 0) || planTotal > 0) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: chartSize === 'full' ? '1fr' : '1fr 1fr',
          gap: '0.9rem',
        }}>
          {hasBmp && trendPoints.length > 0 && (
            <Section title="Purchase Trend" sub={`${bmpSource} · Paywall views + purchases · ${vLabel}`} style={{ height: '100%' }}>
              <div style={{ ...CARD, padding: '0.75rem', flex: 1 }}>
                <IntervalChart data={trendPoints} series={trendSeries} size={chartSize} defaultType="line" />
              </div>
            </Section>
          )}
          {planTotal > 0 && (
            <Section title="Plan Mix" sub={`${bmpSource} · Purchases by tier · click to filter`} style={{ height: '100%' }}>
              <div style={{ ...CARD, padding: '0.75rem 1rem', display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                <div style={{ flexShrink: 0 }}>
                  <PieChart width={chartSize === 'large' ? 170 : 130} height={chartSize === 'large' ? 170 : 130}>
                    <Pie
                      data={planPieData} dataKey="value" cx="50%" cy="50%"
                      innerRadius={chartSize === 'large' ? 50 : 38}
                      outerRadius={chartSize === 'large' ? 76 : 60}
                      paddingAngle={2} stroke="var(--sp-bg)" strokeWidth={2}
                    >
                      {planPieData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                      contentStyle={{ fontSize: '11px', background: '#151b24', border: '1px solid #252f3e', borderRadius: '6px', padding: '5px 9px' }}
                      itemStyle={{ color: '#f1f5f9', fontWeight: 600 }} labelStyle={{ color: '#a8b8cc' }} cursor={false}
                    />
                  </PieChart>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.45rem', minWidth: '120px' }}>
                  {planCounts.filter((i) => i.count > 0).map((item) => {
                    const pct: number = Math.round((item.count / planTotal) * 100);
                    const isHidden: boolean = hiddenPlans.has(item.label);
                    return (
                      <div
                        key={item.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => togglePlan(item.label)}
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') togglePlan(item.label); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', opacity: isHidden ? 0.35 : 1, transition: 'opacity 0.15s' }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: '2px', background: item.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: '0.65rem', color: 'var(--sp-tx2)', textDecoration: isHidden ? 'line-through' : 'none' }}>{item.label}</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace' }}>{item.count.toLocaleString()}</span>
                        <span style={{ width: '30px', fontSize: '0.6rem', color: 'var(--sp-tx2)', textAlign: 'right' }}>{pct}%</span>
                      </div>
                    );
                  })}
                  {hiddenPlans.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setHiddenPlans(new Set<string>())}
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
      )}

      {/* Purchase Mix Trend — plan tier breakdown over time */}
      {hasBmp && tierTrendPoints.length > 0 && planTotal > 0 && (
        <Section title="Purchase Mix Trend" sub={`${bmpSource} · Purchases by plan tier over time · ${vLabel}`}>
          <div style={{ ...CARD, padding: '0.75rem' }}>
            <IntervalChart data={tierTrendPoints} series={tierTrendSeries} size={chartSize} defaultType="bar" />
          </div>
        </Section>
      )}

    </div>
  );
}
