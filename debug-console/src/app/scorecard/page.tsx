'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import ProtectedRoute from '@/components/ProtectedRoute';
import ThemeToggle from '@/components/supportplane/_shell/ThemeToggle';
import sp from '@/components/supportplane/sp.module.css';
import { useAuth } from '@/hooks/useAuth';

import ScorecardSidebar from './ScorecardSidebar';
import {
  AppProvisioning, FeedbackDeepDive, FeedbackOverview, Journey, Overview,
  RevenueOverview, RevenueFunnel, RevenueSubscriptions,
} from './pages';
import { C1LiveFeed } from './pages/C1LiveFeed';
import type { FeedbackSubTab, MetricValue, ScorecardChartSize, ScorecardData, ScorecardRange, TabId, TrendView } from './types';
import { FEEDBACK_SUB_LABELS, TAB_LABELS } from './types';
import { useDatasourceStatus } from './hooks/useDatasourceStatus';
import { useScorecardBmp } from './hooks/useScorecardBmp';
import { useLokiData } from './hooks/useLokiData';
import { usePdnaData, type PdnaTlaFilter, type ScorecardPdnaData } from './hooks/usePdnaData';
import { useS3Feedback } from './hooks/useS3Feedback';

const RANGE_LABELS: Record<ScorecardRange, string> = {
  '24h': '24h', '7d': '7d', '14d': '14d', '30d': '30d', '90d': '90d', 'custom': 'Custom',
};

const SIZE_OPTIONS: Array<{ id: ScorecardChartSize; label: string; hint: string }> = [
  { id: 'small', label: 'S',    hint: 'Small — compact grid'        },
  { id: 'large', label: 'L',    hint: 'Large — expanded layout'     },
  { id: 'full',  label: 'Full', hint: 'Full width — one chart per row' },
];

const TREND_VIEW_OPTIONS: Array<{ id: TrendView; label: string }> = [
  { id: 'daily',   label: 'Day'   },
  { id: 'weekly',  label: 'Week'  },
  { id: 'monthly', label: 'Month' },
  { id: 'yearly',  label: 'Year'  },
];

function dateLabel(customFrom: string, customTo: string): string {
  if (!customFrom || !customTo) return 'Custom';
  const MONTHS: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = (d: string): string => {
    const parts: string[] = d.split('-');
    const mIdx: number    = parseInt(parts[1] ?? '', 10) - 1;
    const day: number     = parseInt(parts[2] ?? '', 10);
    return (mIdx >= 0 && mIdx < 12) ? `${MONTHS[mIdx]} ${day}` : d;
  };
  return `${fmt(customFrom)} – ${fmt(customTo)}`;
}

const ZERO_METRIC: MetricValue = { rate: null, numerator: 0, denominator: 0 };

function createScorecardData(pdna: ScorecardPdnaData | null): ScorecardData {
  const paidUnitsToday   = pdna && !pdna.configMissing ? pdna.paidUnitsToday   : 0;
  const paidUnitsInRange = pdna && !pdna.configMissing ? pdna.paidUnitsInRange : 0;
  const purchaseStarter  = pdna && !pdna.configMissing ? pdna.purchaseStarter  : 0;
  const purchasePro      = pdna && !pdna.configMissing ? pdna.purchasePro      : 0;
  const purchaseUltimate = pdna && !pdna.configMissing ? pdna.purchaseUltimate : 0;

  return {
    funnel: {
      steps: [],
      publishRate: ZERO_METRIC,
      taskCompletion: ZERO_METRIC,
      blockedPublish: ZERO_METRIC,
      blockedReasons: [],
    },
    revenue: {
      paidUnitsToday,
      paidUnitsInRange,
      paywallViews: 0,
      ctaClicks: 0,
      purchases: 0,
      conversionRate: null,
      ctaClickRate: null,
      d2pModalShown: 0,
      d2pLoadSuccess: 0,
      d2pCheckoutStart: 0,
      d2pCheckoutError: 0,
      purchaseStarter,
      purchasePro,
      purchaseUltimate,
      planCancellation: 0,
      managePlanDowngrade: 0,
      managePlanSuspended: 0,
      creditBudgetExceeded: 0,
      creditThresholdWarning: 0,
      creditThresholdDepleted: 0,
      creditPurchaseSuccess: 0,
      creditUsageConsumed: 0,
      budgetNewUserEligible: 0,
      upgradeBannerView: 0,
      upgradeBannerClick: 0,
      upgradeBannerClose: 0,
      upgradeBannerConversionRate: null,
      settingsAnalyticsUpgradeCta: 0,
      settingsAnalyticsUpgradeBanner: 0,
      paymentIntentDetected: 0,
      paymentSkillInvoked: 0,
      paymentSetupStarted: 0,
      paymentSetupCompleted: 0,
      paymentSetupVerified: 0,
      paymentSetupConversionRate: null,
    },
    feedback: {
      totalSubmits: 0,
      positiveRate: null,
      appFeedbackTotal: 0,
      appPositiveRate: null,
      appGenView: 0,
      appGenClose: 0,
      agentFeedbackTotal: 0,
      agentPositiveRate: null,
      agentWorkView: 0,
      agentWorkClose: 0,
      msgFeedbackTotal: 0,
      msgPositiveRate: null,
      chatFeedbackView: 0,
      chatFeedbackClose: 0,
      chatFeedbackAction: 0,
      publishFailureRate: null,
      topFailureReasons: [],
      topFailureCategories: [],
      publishFailureTotal: 0,
      publishFailuresByStage: [],
      issueReports: 0,
      supportRequests: 0,
      feedbackModalOpened: 0,
      feedbackModalUserOpened: 0,
      feedbackModalClosed: 0,
      feedbackCategoryView: 0,
      feedbackCategoryIssue: 0,
      feedbackCategorySupport: 0,
      feedbackCategoryShare: 0,
      feedbackIssueView: 0,
      feedbackIssueSuccess: 0,
      feedbackSupportView: 0,
      feedbackSupportSuccess: 0,
      feedbackShareView: 0,
      feedbackShareSubmit: 0,
      feedbackShareSuccess: 0,
    },
    prevKR: null,
  };
}

interface DsEntry {
  label: string;
  configured: boolean | undefined;
  titleOn: string;
  titleOff: string;
  color: string;
}

function deriveDsStatus(
  loading: boolean,
  data: { configMissing: boolean; error?: string } | null,
): boolean | undefined {
  if (loading) return undefined;
  if (data === null) return false;
  if (data.configMissing || data.error) return false;
  return true;
}

function SourceHealthBar({ sources }: { sources: DsEntry[] }) {
  return (
    <div className={sp.healthBar}>
      <span className={sp.healthBarLabel}>Sources</span>
      {sources.map(({ label, configured, titleOn, titleOff, color }) => {
        const loading: boolean = configured === undefined;
        const on: boolean      = configured === true;
        const dotColor: string = loading ? 'var(--sp-txm)' : on ? 'var(--sp-success)' : 'var(--sp-danger)';
        const borderColor: string = loading ? 'var(--sp-border)' : on ? `${color}40` : 'var(--sp-border)';
        const textColor: string   = loading ? 'var(--sp-txm)' : on ? color : 'var(--sp-txm)';
        return (
          <span
            key={label}
            title={loading ? `${label} — checking…` : on ? titleOn : titleOff}
            className={sp.healthPillMini}
            style={{ borderColor, color: textColor }}
          >
            <span className={sp.healthDotDot} style={{ background: dotColor }} />
            {label}
          </span>
        );
      })}
    </div>
  );
}

function ScorecardContent() {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  const [theme, setTheme]         = useState<'light' | 'dark'>('dark');
  const [collapsed, setCollapsed] = useState(false);
  const [range, setRange]         = useState<ScorecardRange>('7d');
  const [customFrom, setFrom]     = useState('');
  const [customTo, setTo]         = useState('');
  const [activePage, setActivePage]         = useState<TabId>('overview');
  const [feedbackPage, setFeedbackPage]     = useState<FeedbackSubTab>('overview');

  const selectFeedback = useCallback((sub: FeedbackSubTab): void => {
    setActivePage('feedback');
    setFeedbackPage(sub);
  }, []);
  const [journeyId, setJourneyId] = useState('');
  const [chartSize, setChartSize] = useState<ScorecardChartSize>('small');
  const [trendView, setTrendView] = useState<TrendView>('daily');
  const [tlaFilter, setTlaFilter] = useState<PdnaTlaFilter>('non-tla');

  useEffect(() => {
    const t: string | null = localStorage.getItem('scorecard-theme');
    if (t === 'light' || t === 'dark') setTheme(t);
    setCollapsed(localStorage.getItem('scorecard-collapsed') === 'true');
  }, []);

  useEffect(() => {
    containerRef.current?.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const n: 'light' | 'dark' = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('scorecard-theme', n);
      return n;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem('scorecard-collapsed', String(!c));
      return !c;
    });
  }, []);

  const dsStatus = useDatasourceStatus();
  const { data: bmpAllData, loading: bmpLoading }                                         = useScorecardBmp(range, customFrom, customTo);
  const { data: pdnaData, loading: pdnaLoading }                                          = usePdnaData(range, customFrom, customTo, tlaFilter);
  const { data: s3Feedback, loading: s3Loading, error: s3Error, progress: s3Progress }    = useS3Feedback(range, customFrom, customTo);
  const { data: lokiData, loading: lokiLoading, error: lokiHookError }                    = useLokiData(range, customFrom, customTo);
  const bmpData              = bmpAllData?.bmp              ?? null;
  const websiteData          = bmpAllData?.website          ?? null;
  const dimEntryPointData    = bmpAllData?.dimEntryPoint    ?? null;
  const dimPlanTypeData      = bmpAllData?.dimPlanType      ?? null;
  const dimCreationSourceData = bmpAllData?.dimCreationSource ?? null;
  const dimIntentData        = bmpAllData?.dimIntent        ?? null;
  const paywallData          = bmpAllData?.paywall          ?? null;
  const data: ScorecardData = createScorecardData(pdnaData);

  const goToJourney = useCallback((appId: string) => {
    setJourneyId(appId);
    setActivePage('journey');
  }, []);

  const rangeLabel: string = range === 'custom'
    ? (customFrom && customTo ? dateLabel(customFrom, customTo) : 'pick dates ↓')
    : RANGE_LABELS[range];

  const initials: string = (user?.email ?? user?.shopperId ?? 'U')
    .slice(0, 2).toUpperCase();

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer',
    fontSize: '11.5px', fontWeight: active ? 600 : 500,
    background: active ? 'var(--sp-accent)' : 'var(--sp-s3)',
    color: active ? '#fff' : 'var(--sp-tx2)',
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.12s, color 0.12s',
  });

  const ctrlLabel: React.CSSProperties = {
    fontSize: '9.5px', fontWeight: 700, color: 'var(--sp-txm)',
    textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap',
  };

  const ctrlGroup: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '4px',
    background: 'var(--sp-s1)', border: '1px solid var(--sp-border)',
    borderRadius: '8px', padding: '4px 8px',
  };

  const bmpStatus: boolean | undefined  = deriveDsStatus(bmpLoading,  bmpAllData?.bmp  ?? null);
  const pdnaStatus: boolean | undefined = deriveDsStatus(pdnaLoading, pdnaData         ?? null);
  const lokiStatus: boolean | undefined = deriveDsStatus(lokiLoading, lokiData         ?? null);
  const s3Status: boolean | undefined   = s3Loading ? undefined
    : s3Error            ? false
    : s3Feedback === null ? undefined
    : s3Feedback.configMissing ? false
    : true;

  const bmpErrDetail: string  = bmpAllData?.bmp?.error  ?? (bmpAllData?.bmp?.configMissing ? 'no auth cookie — open via local.console.airo-builder.gdcorp.tools:3443 with prod SSO' : 'fetch failed');
  const pdnaErrDetail: string = pdnaData?.configMissing ? 'set PDNA_ES_ENDPOINT and PDNA_ES_API_KEY in .env.local' : 'fetch failed';
  const s3ErrDetail: string   = s3Error ?? (s3Feedback?.configMissing ? 'set FEEDBACK_S3_BUCKET in .env.local' : 'no data');
  const lokiErrDetail: string = lokiHookError ?? lokiData?.error ?? (lokiData?.configMissing ? 'set LOKI_ENDPOINT in .env.local' : 'fetch failed');

  const sources: DsEntry[] = [
    { label: 'BMP',       configured: bmpStatus,                        color: '#7c3aed', titleOn: 'BMP — connected (prod SSO)',                        titleOff: `BMP — ${bmpErrDetail}`                                                                       },
    { label: 'S3',        configured: s3Status,                         color: '#0891b2', titleOn: 'S3 Parquet — connected. Love score enabled.',        titleOff: `S3 — ${s3ErrDetail}`                                                                         },
    { label: 'PDNA',      configured: pdnaStatus,                       color: '#7c3aed', titleOn: 'PDNA — connected. Paid units enabled.',               titleOff: `PDNA — ${pdnaErrDetail}`                                                                     },
    { label: 'Loki',      configured: lokiStatus,                       color: '#ea580c', titleOn: 'Loki — connected. Publish outcomes enabled.',         titleOff: `Loki — ${lokiErrDetail}`                                                                     },
    { label: 'C1',        configured: dsStatus?.c1.configured,          color: '#0d9488', titleOn: 'C1 ClickHouse — connected. Live Event Feed enabled.', titleOff: 'C1 — not connected. Set CLICKHOUSE_HOST and CLICKHOUSE_USER in .env.local.'                  },
    { label: 'FullStory', configured: dsStatus?.fullstory.configured,   color: '#d97706', titleOn: 'FullStory — connected. Journey tab enabled.',         titleOff: 'FullStory — not connected. Set FULLSTORY_API_KEY in .env.local.'                            },
  ];

  return (
    <div ref={containerRef} className={sp.sp} data-theme={theme}>
      <ScorecardSidebar
        active={activePage}
        collapsed={collapsed}
        feedbackSubTab={feedbackPage}
        onSelect={setActivePage}
        onSelectFeedbackSubTab={selectFeedback}
        onToggle={toggleSidebar}
      />

      <div className={sp.main}>
        {/* Header */}
        <header className={sp.header}>
          <div className={sp.headerLeft}>
            <span className={sp.panelBreadcrumb}>
              Scorecard
              <span className={sp.breadcrumbSep}>/</span>
              {activePage === 'feedback' ? (
                <>
                  <span className={sp.breadcrumbLeaf}>Feedback</span>
                  <span className={sp.breadcrumbSep}>/</span>
                  <span className={sp.breadcrumbLeaf}>{FEEDBACK_SUB_LABELS[feedbackPage]}</span>
                </>
              ) : (
                <span className={sp.breadcrumbLeaf}>{TAB_LABELS[activePage]}</span>
              )}
            </span>
          </div>
          {/* Centre: data sources health bar */}
          <SourceHealthBar sources={sources} />
          <div className={sp.headerRight}>
            <a href="/" className={sp.backBtn}>← Dashboard</a>
            <ThemeToggle isDark={theme === 'dark'} onToggle={toggleTheme} />
            <div className={sp.userChip}>
              <div className={sp.userAvatar}>{initials}</div>
              <span className={sp.userName}>{user?.email ?? user?.shopperId ?? 'Dev'}</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className={sp.content}>
          <div className={sp.panelRoot}>

            {/* Controls — sticky toolbar (hidden on Journey page which manages its own context) */}
            {activePage !== 'journey' && (
              <div style={{
                position: 'sticky', top: 0, zIndex: 10,
                background: 'var(--sp-bg)', borderBottom: '1px solid var(--sp-border)',
                margin: '-24px -28px 20px', padding: '10px 28px',
                display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
              }}>
                <div style={ctrlGroup}>
                  <span style={ctrlLabel}>Range</span>
                  {(Object.keys(RANGE_LABELS) as ScorecardRange[]).map((v) => (
                    <button key={v} type="button" onClick={() => setRange(v)} style={pillStyle(range === v)}>
                      {v === 'custom' ? (range === 'custom' && customFrom && customTo ? dateLabel(customFrom, customTo) : 'Custom') : RANGE_LABELS[v]}
                    </button>
                  ))}
                </div>

                {range === 'custom' && (
                  <div style={{ ...ctrlGroup, gap: '6px' }}>
                    <span style={ctrlLabel}>From</span>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setFrom(e.target.value)}
                      className={sp.searchInput}
                      style={{ width: '128px', padding: '3px 7px', fontSize: '11.5px', colorScheme: theme }}
                    />
                    <span style={ctrlLabel}>To</span>
                    <input
                      type="date"
                      value={customTo}
                      min={customFrom}
                      onChange={(e) => setTo(e.target.value)}
                      className={sp.searchInput}
                      style={{ width: '128px', padding: '3px 7px', fontSize: '11.5px', colorScheme: theme }}
                    />
                  </div>
                )}

                {!(activePage === 'feedback' && feedbackPage === 'deep-dive') && (
                  <>
                    <div style={ctrlGroup}>
                      <span style={ctrlLabel}>Chart Size</span>
                      {SIZE_OPTIONS.map((opt) => (
                        <button key={opt.id} type="button" title={opt.hint} onClick={() => setChartSize(opt.id)} style={pillStyle(chartSize === opt.id)}>
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div style={ctrlGroup}>
                      <span style={ctrlLabel}>Trend</span>
                      {TREND_VIEW_OPTIONS.map((opt) => (
                        <button key={opt.id} type="button" onClick={() => setTrendView(opt.id)} style={pillStyle(trendView === opt.id)}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <span style={{ fontSize: '11px', color: 'var(--sp-txm)', marginLeft: 'auto', fontWeight: 500 }}>
                  {rangeLabel}
                </span>
              </div>
            )}

            {/* Page content */}
            {activePage === 'journey' ? (
              <Journey initialAppId={journeyId} s3Feedback={s3Feedback} />
            ) : range === 'custom' && (!customFrom || !customTo) ? (
              <div className={sp.emptyState}>
                <p style={{ margin: 0 }}>Pick a From and To date above to load data.</p>
              </div>
            ) : (
              <>
                {activePage === 'overview' && (
                  <>
                    <Overview
                      data={data} range={rangeLabel} onTabChange={setActivePage}
                      s3Feedback={s3Feedback} s3Loading={s3Loading} s3Progress={s3Progress} lokiData={lokiData}
                      websiteData={websiteData}
                      dimEntryPointData={dimEntryPointData}
                      dimPlanTypeData={dimPlanTypeData}
                      dimCreationSourceData={dimCreationSourceData}
                      dimIntentData={dimIntentData}
                      bmpData={bmpData} paywallData={paywallData}
                      chartSize={chartSize} trendView={trendView}
                      tlaFilter={tlaFilter} onTlaChange={setTlaFilter}
                      bmpLoading={bmpLoading}
                    />
                    <div style={{ marginTop: '1rem' }}>
                      <C1LiveFeed onSelectApp={goToJourney} />
                    </div>
                  </>
                )}
                {activePage === 'feedback' && feedbackPage === 'overview' && (
                  <FeedbackOverview
                    data={data} range={rangeLabel}
                    chartSize={chartSize} trendView={trendView}
                    s3Feedback={s3Feedback} s3Loading={s3Loading}
                    bmpData={bmpData}
                  />
                )}
                {activePage === 'feedback' && feedbackPage === 'deep-dive' && (
                  <FeedbackDeepDive
                    data={data} feedRange={range} customFrom={customFrom} customTo={customTo}
                    chartSize={chartSize} onSelectApp={goToJourney}
                    s3Feedback={s3Feedback} s3Loading={s3Loading}
                  />
                )}
                {activePage === 'revenue' && (
                  <RevenueOverview
                    data={data} range={rangeLabel} paywallData={paywallData}
                    chartSize={chartSize} trendView={trendView}
                    bmpLoading={bmpLoading}
                  />
                )}
                {activePage === 'revenuefunnel' && (
                  <RevenueFunnel
                    data={data} range={rangeLabel}
                    websiteData={websiteData}
                    dimPlanTypeData={dimPlanTypeData}
                    dimIntentData={dimIntentData}
                    paywallData={paywallData}
                    chartSize={chartSize} trendView={trendView}
                    bmpLoading={bmpLoading}
                  />
                )}
                {activePage === 'subscriptions' && (
                  <RevenueSubscriptions
                    paywallData={paywallData}
                    rawRange={range} customFrom={customFrom} customTo={customTo}
                    chartSize={chartSize} trendView={trendView}
                    bmpLoading={bmpLoading}
                  />
                )}
                {activePage === 'appprovisioning' && (
                  <AppProvisioning
                    rawRange={range} customFrom={customFrom} customTo={customTo} chartSize={chartSize} trendView={trendView}
                  />
                )}

              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScorecardPage() {
  return (
    <ProtectedRoute>
      <ScorecardContent />
    </ProtectedRoute>
  );
}
