// ── Scorecard data types ──────────────────────────────────────────────────────

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  pctOfFirst: number;
  dropFromPrev: number | null;
  description?: string;
}

export interface MetricValue {
  rate: number | null;
  numerator: number;
  denominator: number;
}

export interface KRDelta {
  prevPaidUnits: number;
  prevLoveScore: number | null;
  paidUnitsDelta: number | null;
  paidUnitsDeltaPct: number | null;
  loveScoreDelta: number | null;
}

export interface ScorecardData {
  funnel: {
    steps: FunnelStep[];
    publishRate: MetricValue;
    taskCompletion: MetricValue;
    blockedPublish: MetricValue;
    blockedReasons: Array<{ reason: string; count: number }>;
  };
  revenue: {
    paidUnitsToday: number;
    paidUnitsInRange: number;
    paywallViews: number;
    ctaClicks: number;
    purchases: number;
    conversionRate: number | null;
    ctaClickRate: number | null;
    d2pModalShown: number;
    d2pLoadSuccess: number;
    d2pCheckoutStart: number;
    d2pCheckoutError: number;
    purchaseStarter: number;
    purchasePro: number;
    purchaseUltimate: number;
    planCancellation: number;
    managePlanDowngrade: number;
    managePlanSuspended: number;
    creditBudgetExceeded: number;
    creditThresholdWarning: number;
    creditThresholdDepleted: number;
    creditPurchaseSuccess: number;
    creditUsageConsumed: number;
    budgetNewUserEligible: number;
    upgradeBannerView: number;
    upgradeBannerClick: number;
    upgradeBannerClose: number;
    upgradeBannerConversionRate: number | null;
    settingsAnalyticsUpgradeCta: number;
    settingsAnalyticsUpgradeBanner: number;
    paymentIntentDetected: number;
    paymentSkillInvoked: number;
    paymentSetupStarted: number;
    paymentSetupCompleted: number;
    paymentSetupVerified: number;
    paymentSetupConversionRate: number | null;
  };
  feedback: {
    totalSubmits: number;
    positiveRate: number | null;
    appFeedbackTotal: number;
    appPositiveRate: number | null;
    appGenView: number;
    appGenClose: number;
    agentFeedbackTotal: number;
    agentPositiveRate: number | null;
    agentWorkView: number;
    agentWorkClose: number;
    msgFeedbackTotal: number;
    msgPositiveRate: number | null;
    chatFeedbackView: number;
    chatFeedbackClose: number;
    chatFeedbackAction: number;
    publishFailureRate: number | null;
    topFailureReasons: Array<{ reason: string; count: number }>;
    topFailureCategories: Array<{ category: string; count: number }>;
    publishFailureTotal: number;
    publishFailuresByStage: Array<{ stage: string; count: number }>;
    issueReports: number;
    supportRequests: number;
    feedbackModalOpened: number;
    feedbackModalUserOpened: number;
    feedbackModalClosed: number;
    feedbackCategoryView: number;
    feedbackCategoryIssue: number;
    feedbackCategorySupport: number;
    feedbackCategoryShare: number;
    feedbackIssueView: number;
    feedbackIssueSuccess: number;
    feedbackSupportView: number;
    feedbackSupportSuccess: number;
    feedbackShareView: number;
    feedbackShareSubmit: number;
    feedbackShareSuccess: number;
  };
  prevKR: KRDelta | null;
}

export interface JourneyEvent {
  timestamp: string;
  event: string;
  label: string;
  data: Record<string, unknown>;
  fullstoryUrl: string | null;
  isKeyEvent: boolean;
  status: 'success' | 'error' | 'warning' | 'info';
}

export interface JourneySession {
  sessionId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  fullstorySessionUrl: string | null;
  events: JourneyEvent[];
  outcome: 'published' | 'abandoned' | 'in_progress';
}

export interface AppJourneyData {
  appId: string;
  env: string;
  totalSessions: number;
  firstSeen: string;
  lastSeen: string;
  sessions: JourneySession[];
  businessName: string | null;
}

// ── UI-only types ─────────────────────────────────────────────────────────────

export type ScorecardRange      = '24h' | '7d' | '14d' | '30d' | '90d' | 'custom';
export type ScorecardChartSize  = 'small' | 'large' | 'full';
export type TrendView           = 'daily' | 'weekly' | 'monthly' | 'yearly';
export const TAB_IDS = [
  'overview', 'feedback', 'revenue', 'appprovisioning', 'journey',
] as const;
export type TabId = typeof TAB_IDS[number];

export const TAB_LABELS: Record<TabId, string> = {
  overview:         'Overview',
  feedback:         'Feedback',
  revenue:          'Revenue',
  appprovisioning:  'Apps',
  journey:          'Journey',
};
