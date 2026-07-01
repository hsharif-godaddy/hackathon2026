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

/** How an individual FullStory event is categorized for segregated display. */
export type JourneyEventCategory =
  | 'navigation'     // page navigations and route changes
  | 'interaction'    // clicks, scrolls, element visibility
  | 'error'          // rage-click, dead-click, console errors, exceptions
  | 'feedback'       // explicit feedback events
  | 'instrumentation'; // custom events fired by Airo app instrumentation code

export interface JourneyEvent {
  timestamp: string;
  event: string;
  label: string;
  data: Record<string, unknown>;
  fullstoryUrl: string | null;
  isKeyEvent: boolean;
  status: 'success' | 'error' | 'warning' | 'info';
  category: JourneyEventCategory;
}

/** Lightweight session metadata — no events. Returned by the journey-list endpoint. */
export interface JourneySessionMeta {
  sessionId: string;
  deviceId: string;
  startTime: string;
  fullstorySessionUrl: string | null;
}

export interface JourneySession {
  sessionId: string;
  deviceId: string;
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

/** Response shape for the journey-list action (session metadata only, no events). */
export interface JourneyListData {
  appId: string;
  /** Number of sessions in this page response (not cumulative). */
  totalSessions: number;
  lookbackDays: number;
  sessions: JourneySessionMeta[];
  /** Opaque cursor — present when more pages are available. Pass as pageToken for the next request. */
  nextPageToken?: string;
  /** FullStory segment ID built for this appId. Pass as segmentId to skip rebuilding on subsequent pages. */
  segmentId?: string;
}

// ── UI-only types ─────────────────────────────────────────────────────────────

export type ScorecardRange      = '24h' | '7d' | '14d' | '30d' | '90d' | 'custom';
export type ScorecardChartSize  = 'small' | 'large' | 'full';
export type TrendView           = 'daily' | 'weekly' | 'monthly' | 'yearly';
export const TAB_IDS = [
  'overview', 'appprovisioning',
  'revenue', 'revenuefunnel', 'subscriptions',
  'feedback', 'journey',
] as const;
export type TabId = typeof TAB_IDS[number];

export const TAB_LABELS: Record<TabId, string> = {
  overview:        'Overview',
  appprovisioning: 'Apps',
  revenue:         'Overview',
  revenuefunnel:   'Funnel',
  subscriptions:   'Subscriptions',
  feedback:        'Feedback',
  journey:         'Journey',
};

export const FEEDBACK_SUB_IDS = ['overview', 'deep-dive'] as const;
export type FeedbackSubTab = typeof FEEDBACK_SUB_IDS[number];
export const FEEDBACK_SUB_LABELS: Record<FeedbackSubTab, string> = {
  'overview':   'Overview',
  'deep-dive':  'Deep Dive',
};
