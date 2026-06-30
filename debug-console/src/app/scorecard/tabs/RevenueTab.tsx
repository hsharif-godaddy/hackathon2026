'use client';

import React, { useState } from 'react';

import { CARD, IntervalChart, MetricCard, RevenueStepDetail, Section, StatCard, cardGrid } from '../components';
import type { IntervalDataPoint, IntervalSeries } from '../components';
import { bmpVal } from '../hooks/useBmpData';
import type { BmpInterval, BmpMetric, ScorecardBmpFeedbackData } from '../hooks/useBmpData';
import { usePdnaAppsData } from '../hooks/usePdnaAppsData';
import type { ScorecardChartSize, ScorecardData, ScorecardRange, TrendView } from '../types';
import { aggregateByView, viewLabel } from '../trendAggregation';

interface RevStep { name: string; count: number }

function sumPaywall(metrics: BmpMetric[], name: string): number {
  return metrics.reduce((acc, m) => acc + bmpVal(m.aggregatedSummary, name), 0);
}

const INTERVAL_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'paywall_view',          label: 'Paywall Views',  color: '#6366f1' },
  { key: 'purchase_success',      label: 'Purchases',      color: '#10b981' },
  { key: 'credits_purchase',      label: 'Credits Bought', color: '#f59e0b' },
];

const PDNA_PLAN_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'starter',      label: 'Starter',      color: '#0284c7' },
  { key: 'professional', label: 'Professional',  color: '#7c3aed' },
  { key: 'ultimate',     label: 'Ultimate',      color: '#0891b2' },
  { key: 'free',         label: 'Free',          color: 'var(--sp-tx2)' },
];

const PLAN_INTERVAL_MEASURES: { key: string; label: string; color: string }[] = [
  { key: 'purchase_starter',      label: 'Starter',        color: '#0284c7' },
  { key: 'purchase_professional', label: 'Professional',   color: '#7c3aed' },
  { key: 'purchase_ultimate',     label: 'Ultimate',       color: '#0891b2' },
  { key: 'plan_cancellation',     label: 'Cancellations',  color: '#ef4444' },
];

function buildPaywallTimeSeries(
  metrics: BmpMetric[],
  measures: { key: string; label: string; color: string }[],
): { points: IntervalDataPoint[]; series: IntervalSeries[] } {
  const dateMap = new Map<string, Map<string, number>>();
  for (const m of metrics) {
    for (const interval of (m.intervals ?? [] as BmpInterval[])) {
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

interface Props {
  data:          ScorecardData;
  range:         string;
  rawRange:      ScorecardRange;
  customFrom:    string;
  customTo:      string;
  chartSize:     ScorecardChartSize;
  trendView?:    TrendView;
  paywallData?:  ScorecardBmpFeedbackData | null;
}

const FUNNEL_COLORS = ['#1e40af', '#0284c7', '#0891b2', '#7c3aed', '#6366f1', '#10b981'];

function FunnelRows({ steps, baseCount }: { steps: RevStep[]; baseCount: number }) {
  const base = baseCount > 0 ? baseCount : Math.max(...steps.map(s => s.count), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {steps.map((step, idx) => {
        const pct = base > 0 ? Math.round((step.count / base) * 100) : 0;
        const prevCount = idx > 0 ? steps[idx - 1].count : null;
        const drop = prevCount != null && prevCount > 0
          ? Math.round(((prevCount - step.count) / prevCount) * 100) : null;
        return (
          <React.Fragment key={step.name}>
            {drop !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingLeft: '120px' }}>
                <div style={{ width: '2px', height: '12px', background: 'var(--sp-border)', marginLeft: '0.5rem', flexShrink: 0 }} />
                <span style={{ fontSize: '0.57rem', fontWeight: 700, color: drop > 30 ? '#ef4444' : drop > 15 ? '#f59e0b' : '#10b981', background: drop > 30 ? 'rgba(239,68,68,0.12)' : drop > 15 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)', padding: '0.04rem 0.28rem', borderRadius: '8px' }}>↓ {drop}%</span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: '120px', fontSize: '0.62rem', color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{step.name}</span>
              <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '20px' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: FUNNEL_COLORS[idx % FUNNEL_COLORS.length], borderRadius: '3px', transition: 'width 0.5s' }} />
              </div>
              <span style={{ width: '52px', fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>{step.count.toLocaleString()}</span>
              <span style={{ width: '36px', fontSize: '0.6rem', color: 'var(--sp-tx2)', flexShrink: 0 }}>{pct}%</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function RevenueTab({ data, range, rawRange, customFrom, customTo, chartSize, trendView = 'daily', paywallData }: Props) {
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const rv = data.revenue;

  // BMP paywall_conversion_events — override PDNA placeholders where available
  const pwMetrics: BmpMetric[] = paywallData?.metrics ?? [];
  const hasBmpPaywall: boolean = !paywallData?.configMissing && pwMetrics.length > 0;
  const pw = (name: string): number => sumPaywall(pwMetrics, name);

  const paywallViews:    number = hasBmpPaywall ? pw('paywall_view')          : rv.paywallViews;
  const purchases:       number = hasBmpPaywall ? pw('purchase_success')      : rv.purchases;
  const purchaseStarter: number = hasBmpPaywall ? pw('purchase_starter')      : rv.purchaseStarter;
  const purchasePro:     number = hasBmpPaywall ? pw('purchase_professional') : rv.purchasePro;
  const purchaseUltimate:number = hasBmpPaywall ? pw('purchase_ultimate')     : rv.purchaseUltimate;
  const creditsPurchase: number = hasBmpPaywall ? pw('credits_purchase')      : rv.creditPurchaseSuccess;
  const cancellations:   number = hasBmpPaywall ? pw('plan_cancellation')     : rv.planCancellation;
  const downgrades:      number = hasBmpPaywall ? pw('downgrade_scheduled')   : rv.managePlanDowngrade;
  const suspended:       number = hasBmpPaywall ? pw('suspended_nonpayment')  : rv.managePlanSuspended;
  const conversionRate: number | null = paywallViews > 0 ? Math.round((purchases    / paywallViews) * 100) : rv.conversionRate;
  const ctaClickRate:   number | null = paywallViews > 0 ? Math.round((rv.ctaClicks / paywallViews) * 100) : rv.ctaClickRate;

  const bmpSource: string = hasBmpPaywall ? 'BMP · paywall_conversion_events' : 'PDNA (BMP pending)';

  const { data: pdnaAppsResult, loading: pdnaLoading, stale: pdnaAppsStale, error: pdnaAppsError } = usePdnaAppsData(rawRange, customFrom, customTo);
  const pdnaApps = pdnaAppsResult && !pdnaAppsResult.configMissing ? pdnaAppsResult : null;

  // Range-summed subscription counts derived from daily series (range-filtered)
  const rangeByPlan: Record<string, number> = pdnaApps
    ? pdnaApps.subscriptionsDailyByPlan.reduce(
        (acc: Record<string, number>, d: { date: string; byPlan: Record<string, number> }): Record<string, number> => {
          for (const [plan, count] of Object.entries(d.byPlan)) {
            acc[plan] = (acc[plan] ?? 0) + count;
          }
          return acc;
        },
        {},
      )
    : {};
  const rangeTotalSubs: number = pdnaApps
    ? pdnaApps.subscriptionsDaily.reduce((s: number, d: { date: string; subscriptions: number }): number => s + d.subscriptions, 0)
    : 0;

  const steps: RevStep[] = [
    { name: 'Paywall Views', count: paywallViews },
    ...(rv.ctaClicks > 0 ? [{ name: 'CTA Clicks', count: rv.ctaClicks }] : []),
    { name: 'Purchases',     count: purchases    },
  ];

  const paymentSteps: RevStep[] = [
    { name: 'Intent Detected', count: rv.paymentIntentDetected  },
    { name: 'Skill Invoked',   count: rv.paymentSkillInvoked    },
    { name: 'Setup Started',   count: rv.paymentSetupStarted    },
    { name: 'Setup Completed', count: rv.paymentSetupCompleted  },
    { name: 'Verified',        count: rv.paymentSetupVerified   },
  ];

  const toggleStep = (name: string) => setSelectedStep((prev) => (prev === name ? null : name));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <Section title="Revenue Metrics" sub={`${bmpSource} · Paywall + purchase funnel · last ${range}`}>
        <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
          <StatCard   label="Paid Units (Range)"    value={rv.paidUnitsInRange} description={`New + renewals · last ${range}`}    accent="premium" help={{ what: 'Total paid units including new purchases and renewals in the selected range.', how: 'subscriptionsDailyByPlan from PDNA ES (airo-builder-provisioning-summary-prod-*).' }} />
          <StatCard   label="Paid Units (Today)"    value={rv.paidUnitsToday}   description="Latest day (new + renewals)" accent="premium" help={{ what: 'Paid units on the most recent day in the range, including renewals.', how: 'Latest day bucket from PDNA ES subscriptionsDailyByPlan.' }} />
          <StatCard   label="Paywall Views"         value={paywallViews}        description="Users who saw paywall"       help={{ what: 'Count of users who hit any upgrade paywall.', how: 'paywall_view · BMP paywall_conversion_events.' }} />
          <StatCard   label="CTA Clicks"            value={rv.ctaClicks}        description="Upgrade button clicks"       accent="info" help={{ what: 'Users who clicked the Upgrade CTA after seeing the paywall.', how: 'Count of paywall.cta.click events. Browser → BMP (coming soon).' }} />
          <MetricCard label="CTA Click Rate"     metric={{ rate: ctaClickRate,    numerator: rv.ctaClicks,  denominator: paywallViews }} description="CTA clicks ÷ views"   green={40} amber={20} help={{ what: '% of users who saw the paywall and clicked the upgrade CTA.', how: 'ctaClicks ÷ paywall_view. ctaClicks from PDNA; paywall_view from BMP when available.', reading: 'Target ≥40%.' }} />
          <StatCard   label="New Purchases"         value={purchases}           description="New plan purchases only"     accent="premium" help={{ what: 'New plan purchases only — excludes renewals.', how: 'purchase_success · BMP paywall_conversion_events.' }} />
          <MetricCard label="Purchase Conversion Rate" metric={{ rate: conversionRate, numerator: purchases, denominator: paywallViews }} description="Purchases ÷ views" green={10} amber={5} help={{ what: '% of users who saw the upgrade paywall and completed a plan purchase.', how: 'purchase_success ÷ paywall_view · BMP paywall_conversion_events.', reading: 'Target ≥10%.' }} />
        </div>
      </Section>

      {/* Upgrade Banner */}
      {(rv.upgradeBannerView + rv.upgradeBannerClick + rv.settingsAnalyticsUpgradeCta) > 0 && (
        <Section title="Upgrade Banner" sub={`BMP · In-app upgrade prompts · last ${range}`}>
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
            {[
              { label: 'Banner Views',  value: rv.upgradeBannerView,  color: '#6366f1', help: { what: 'Users who saw the in-app upgrade banner prompt.',                         how: 'upgradeBanner.view · BMP website_core_events.' } },
              { label: 'Banner Clicks', value: rv.upgradeBannerClick, color: '#10b981', help: { what: 'Users who clicked the upgrade CTA in the banner.',                        how: 'upgradeBanner.click · BMP website_core_events.' } },
              { label: 'Banner Closed', value: rv.upgradeBannerClose, color: 'var(--sp-tx2)', help: { what: 'Users who dismissed the upgrade banner without clicking.',                  how: 'upgradeBanner.close · BMP website_core_events.', reading: 'High close rate relative to views indicates copy or UX friction.' } },
              ...(rv.settingsAnalyticsUpgradeCta > 0 ? [{ label: 'Settings CTA', value: rv.settingsAnalyticsUpgradeCta, color: '#0284c7', help: { what: 'Upgrade CTA clicks from the Analytics settings screen.', how: 'settings.analytics.upgradeCta · BMP website_core_events.' } }] : []),
              ...(rv.upgradeBannerConversionRate != null ? [{ label: 'Conv. Rate', value: `${rv.upgradeBannerConversionRate}%`, color: rv.upgradeBannerConversionRate >= 10 ? '#10b981' : rv.upgradeBannerConversionRate >= 5 ? '#f59e0b' : '#ef4444', help: { what: 'Banner click-through rate: Banner Clicks ÷ Banner Views.', how: 'upgradeBannerClick ÷ upgradeBannerView · BMP website_core_events.' } }] : []),
            ].map((row) => (
              <StatCard key={row.label} label={row.label} value={row.value} description="" accent={undefined} help={row.help} />
            ))}
          </div>
        </Section>
      )}

      {/* D2P (Direct-to-Purchase) modal flow */}
      {rv.d2pModalShown > 0 && (
        <Section title="Direct-to-Purchase Flow" sub={`BMP · D2P modal + checkout steps · last ${range}`}>
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
            {[
              { label: 'Modal Shown',      value: rv.d2pModalShown,    color: '#6366f1', help: { what: 'Times the Direct-to-Purchase modal was displayed.',                                how: 'd2p.modal.shown · BMP website_core_events.' } },
              { label: 'Load Success',     value: rv.d2pLoadSuccess,   color: '#10b981', help: { what: 'D2P modals that loaded successfully (iframe + product data).',                     how: 'd2p.load.success · BMP website_core_events.', reading: 'Should be near 100% of Modal Shown. A gap indicates load failures.' } },
              { label: 'Checkout Started', value: rv.d2pCheckoutStart, color: '#0284c7', help: { what: 'Users who advanced to the Checkout step within the D2P modal.',                   how: 'd2p.checkout.start · BMP website_core_events.' } },
              { label: 'Checkout Errors',  value: rv.d2pCheckoutError, color: rv.d2pCheckoutError > 0 ? '#ef4444' : '#94a3b8', help: { what: 'Checkout errors within the D2P flow.', how: 'd2p.checkout.error · BMP website_core_events.', reading: 'Any non-zero value warrants investigation — checkout errors directly block purchases.' } },
            ].map((row) => (
              <StatCard key={row.label} label={row.label} value={row.value} description="" accent={undefined} help={row.help} />
            ))}
          </div>
        </Section>
      )}

      {/* Plan Splits + Churn */}
      <Section title="Purchases by Plan" sub={`${bmpSource} · Plan tier breakdown + churn signals · last ${range}`}>
        <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
          <StatCard label="Starter"      value={purchaseStarter}  description="purchase_starter purchases"     accent="info"    help={{ what: 'New Starter plan purchases in the selected range.', how: 'purchase_starter · BMP paywall_conversion_events.', reading: 'Rising count means entry-tier adoption is growing.' }} />
          <StatCard label="Professional" value={purchasePro}      description="purchase_professional purchases" accent="premium" help={{ what: 'New Professional plan purchases in the selected range.', how: 'purchase_professional · BMP paywall_conversion_events.', reading: 'Mid-tier signal. Tracks upsell success from Starter.' }} />
          <StatCard label="Ultimate"     value={purchaseUltimate} description="purchase_ultimate purchases"     accent="premium" help={{ what: 'New Ultimate plan purchases in the selected range.', how: 'purchase_ultimate · BMP paywall_conversion_events.', reading: 'Highest-tier signal. Low count is expected — watch for trend changes.' }} />
          <StatCard label="Credits Purchased"    value={creditsPurchase} description="credits_purchase · BMP"    accent="info"    help={{ what: 'Number of credit pack purchases in the selected range.', how: 'credits_purchase · BMP paywall_conversion_events.', reading: 'Rising credit purchases alongside low plan upgrades may indicate users prefer pay-as-you-go.' }} />
          <StatCard label="Cancellations"        value={cancellations}   description="plan_cancellation events"                   help={{ what: 'Plan cancellations initiated by users in the selected range.', how: 'plan_cancellation · BMP paywall_conversion_events.', reading: 'Compare against new purchases to net churn signal. Spikes here warrant cohort investigation.' }} />
          <StatCard label="Downgrades Scheduled" value={downgrades}      description="downgrade_scheduled events"                 help={{ what: 'Users who scheduled a downgrade to a lower plan tier.', how: 'downgrade_scheduled · BMP paywall_conversion_events.', reading: 'Leading churn indicator — these users have not cancelled yet but intend to reduce spend.' }} />
          <StatCard label="Suspended (Non-Pay)"  value={suspended}       description="suspended_nonpayment events"                help={{ what: 'Accounts suspended due to failed payment or non-payment.', how: 'suspended_nonpayment · BMP paywall_conversion_events.', reading: 'High counts suggest billing collection issues. Cross-check with Stripe failed charges.' }} />
        </div>
      </Section>

      {/* BMP interval trend charts */}
      {hasBmpPaywall && (() => {
        const { points: rawTrend, series: trendSeries } = buildPaywallTimeSeries(pwMetrics, INTERVAL_MEASURES);
        const { points: rawPlan,  series: planSeries  } = buildPaywallTimeSeries(pwMetrics, PLAN_INTERVAL_MEASURES);
        if (rawTrend.length === 0) return null;
        const trendPoints = aggregateByView(rawTrend, INTERVAL_MEASURES.map((m) => m.key), trendView);
        const planPoints  = aggregateByView(rawPlan,  PLAN_INTERVAL_MEASURES.map((m) => m.key), trendView);
        const vLabel = viewLabel(trendView);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: chartSize === 'full' ? '1fr' : 'repeat(2, 1fr)', gap: '0.9rem', alignItems: 'start' }}>
            <Section title="Purchase Trend" sub={`${bmpSource} · Paywall views · purchases · credits · ${vLabel}`}>
              <div style={{ ...CARD, padding: '0.75rem' }}>
                <IntervalChart data={trendPoints} series={trendSeries} size={chartSize} defaultType="line" />
              </div>
            </Section>
            {planPoints.length > 0 && (
              <Section title="Plan Breakdown" sub={`${bmpSource} · Purchases by tier + cancellations · ${vLabel}`}>
                <div style={{ ...CARD, padding: '0.75rem' }}>
                  <IntervalChart data={planPoints} series={planSeries} size={chartSize} defaultType="bar" />
                </div>
              </Section>
            )}
          </div>
        );
      })()}

      {/* Payment Skill Funnel */}
      {rv.paymentIntentDetected > 0 && (
        <Section title="Payment Skill Funnel" sub="BMP · Stripe payment setup conversion per step">
          <div style={CARD}>
            <FunnelRows steps={paymentSteps} baseCount={rv.paymentIntentDetected} />
          </div>
          <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.5rem' }}>
            <MetricCard label="Setup Conversion"
              metric={{ rate: rv.paymentSetupConversionRate, numerator: rv.paymentSetupCompleted, denominator: rv.paymentIntentDetected }}
              description="Completed ÷ intent detected" green={60} amber={30}
              help={{ what: '% of payment intents that completed setup.', how: 'setup_completed ÷ intent_detected. Browser → BMP (coming soon).', reading: 'Target ≥60%.' }}
            />
          </div>
        </Section>
      )}

      {/* Purchase Funnel — full width at bottom */}
      <Section title="Purchase Funnel" sub={`${bmpSource} · Paywall → CTA → purchase conversion · click any step for detail`}>
        <div style={CARD}>
          {paywallViews > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {steps.map((step, idx) => {
                const pct        = paywallViews > 0 ? Math.round((step.count / paywallViews) * 100) : 0;
                const color      = FUNNEL_COLORS[idx % FUNNEL_COLORS.length];
                const isSelected = selectedStep === step.name;
                return (
                  <div key={step.name}
                    onClick={() => toggleStep(step.name)}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && toggleStep(step.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', borderRadius: '6px', padding: '0.25rem 0.35rem', background: isSelected ? 'rgba(99,102,241,0.06)' : 'transparent', transition: 'background 0.15s' }}
                  >
                    <span style={{ width: '110px', fontSize: '0.65rem', color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{step.name}</span>
                    <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: chartSize === 'small' ? '18px' : '22px' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.5s' }} />
                    </div>
                    <span style={{ width: '52px', fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>{step.count.toLocaleString()}</span>
                    <span style={{ width: '40px', fontSize: '0.62rem', color: 'var(--sp-tx2)', flexShrink: 0 }}>{pct}%</span>
                    <span style={{ fontSize: '0.58rem', color: isSelected ? '#6366f1' : '#94a3b8', flexShrink: 0, width: '14px' }}>{isSelected ? '▲' : '▼'}</span>
                  </div>
                );
              })}

              {selectedStep && (() => {
                const idx  = steps.findIndex((s) => s.name === selectedStep);
                const step = steps[idx];
                return step ? (
                  <RevenueStepDetail
                    stepName={step.name}
                    count={step.count}
                    prevCount={idx > 0 ? steps[idx - 1].count : undefined}
                    prevName={idx > 0 ? steps[idx - 1].name : undefined}
                    nextCount={idx < steps.length - 1 ? steps[idx + 1].count : undefined}
                    nextName={idx < steps.length - 1 ? steps[idx + 1].name : undefined}
                    onClose={() => setSelectedStep(null)}
                  />
                ) : null;
              })()}
            </div>
          ) : <div style={{ fontSize: '0.7rem', color: 'var(--sp-tx2)' }}>No paywall data in this range</div>}
        </div>
      </Section>

      {/* Subscription Overview — PDNA range data */}
      {(pdnaLoading && !pdnaApps) || pdnaAppsStale ? (
        <Section title="Subscription Overview" sub="PDNA · loading…">
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ ...CARD, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ height: '9px',  width: '55%', background: 'var(--sp-s3)', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: '22px', width: '40%', background: 'var(--sp-s3)', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <div style={{ height: '8px',  width: '70%', background: 'var(--sp-s3)', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
            ))}
          </div>
          <div style={{ ...CARD, padding: '0.75rem', marginTop: '0.6rem', height: '120px', background: 'var(--sp-s2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--sp-tx2)' }}>Loading chart…</span>
          </div>
        </Section>
      ) : pdnaApps ? (
        <Section title="Subscription Overview" sub={`PDNA · New subscriptions in range · last ${range}`}>
          {pdnaAppsError && (
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.65rem', color: '#f59e0b' }}>Query warning: {pdnaAppsError}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: cardGrid(chartSize), gap: '0.6rem' }}>
            <StatCard label="Total New Subs"      value={rangeTotalSubs}                       description="new subscriptions in range"       accent="premium" help={{ what: 'New subscriptions created within the selected range.', how: 'Sum of subscriptionsDaily for the range · PDNA ES airo-builder-provisioning-summary-prod-*.' }} />
            <StatCard label="New Starter Subs"    value={rangeByPlan['starter']      ?? 0}     description="new starter in range"             accent="info"    help={{ what: 'New Starter plan subscriptions created within the selected range.', how: 'Sum of subscriptionsDailyByPlan[starter] for the range · PDNA ES.' }} />
            <StatCard label="New Pro Subs"        value={rangeByPlan['professional'] ?? 0}     description="new professional in range"        accent="premium" help={{ what: 'New Professional plan subscriptions created within the selected range.', how: 'Sum of subscriptionsDailyByPlan[professional] for the range · PDNA ES.' }} />
            <StatCard label="New Ultimate Subs"   value={rangeByPlan['ultimate']     ?? 0}     description="new ultimate in range"            accent="premium" help={{ what: 'New Ultimate plan subscriptions created within the selected range.', how: 'Sum of subscriptionsDailyByPlan[ultimate] for the range · PDNA ES.' }} />
            <StatCard label="New Free Subs"       value={rangeByPlan['free']         ?? 0}     description="new free in range"                             help={{ what: 'New free plan subscriptions created within the selected range — users who have not yet converted to a paid tier.', how: 'Sum of subscriptionsDailyByPlan[free] for the range · PDNA ES.', reading: 'Large free count relative to paid is the primary upsell target pool.' }} />
          </div>
          {(() => {
            const rawPts: IntervalDataPoint[] = pdnaApps.subscriptionsDailyByPlan
              .filter((r) => PDNA_PLAN_MEASURES.some(({ key }) => (r.byPlan[key] ?? 0) > 0))
              .map((r): IntervalDataPoint => {
                const pt: IntervalDataPoint = { label: r.date.slice(5), _date: r.date };
                for (const { key } of PDNA_PLAN_MEASURES) pt[key] = r.byPlan[key] ?? 0;
                return pt;
              });
            const pts: IntervalDataPoint[] = aggregateByView(rawPts, PDNA_PLAN_MEASURES.map((m) => m.key), trendView);
            const total: number = rangeTotalSubs;
            const distRows: { key: string; label: string; color: string; count: number }[] = PDNA_PLAN_MEASURES
              .map((m) => ({ ...m, count: rangeByPlan[m.key] ?? 0 }))
              .filter((m) => m.count > 0);
            const hasChart: boolean = pts.length > 0;
            const hasDist: boolean  = distRows.length > 0 && total > 0;
            if (!hasChart && !hasDist) return null;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: hasChart && hasDist && chartSize !== 'full' ? '1fr 1fr' : '1fr', gap: '0.6rem', marginTop: '0.6rem' }}>
                {hasChart && (
                  <div style={{ ...CARD, padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)', marginBottom: '0.35rem' }}>PDNA · new subscriptions by plan tier (range)</div>
                    <IntervalChart data={pts} series={PDNA_PLAN_MEASURES} size={chartSize} defaultType="bar" />
                  </div>
                )}
                {hasDist && (
                  <div style={{ ...CARD, padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--sp-tx2)', marginBottom: '0.6rem' }}>PDNA · new subscriptions by plan in range ({total.toLocaleString()} total)</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {distRows.map((m) => {
                        const pct: number = Math.round((m.count / total) * 100);
                        return (
                          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ width: '80px', fontSize: '0.62rem', color: 'var(--sp-tx2)', textAlign: 'right', flexShrink: 0 }}>{m.label}</span>
                            <div style={{ flex: 1, background: 'var(--sp-s3)', borderRadius: '3px', height: '18px' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: m.color, borderRadius: '3px', transition: 'width 0.5s' }} />
                            </div>
                            <span style={{ width: '44px', fontSize: '0.7rem', fontWeight: 700, fontFamily: 'monospace', flexShrink: 0 }}>{m.count.toLocaleString()}</span>
                            <span style={{ width: '30px', fontSize: '0.6rem', color: 'var(--sp-tx2)', flexShrink: 0 }}>{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </Section>
      ) : null}

    </div>
  );
}
