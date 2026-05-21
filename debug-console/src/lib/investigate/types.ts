export type InvestigationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed';

export interface InvestigationInput {
  feedback: string;
  fullstoryUrl?: string | null;
  timeWindow?: string | null;
}

export interface InvestigationState {
  investigationId: string;
  appId: string;
  customerId: string;
  status: InvestigationStatus;
  startedAt: string;
  startedBy: string;
  updatedAt: string;
  heartbeatAt: string;
  phase: string | null;
  lastEvent: string | null;
  input: InvestigationInput;
  resultKey: string | null;
  reportFilename: string | null;
  completedAt: string | null;
  durationMs: number | null;
  lambdaRequestId: string | null;
  evidence?: {
    status: 'ready' | 'uploaded' | 'partial' | 'failed';
    key?: string;
    artifactCount?: number;
    uploadedCount?: number;
    window?: {
      label: string;
      from: string;
      to: string;
      hours: number;
    };
    stats?: {
      durationMs: number;
      endpointCount: number;
      failedCount: number;
      bytes: number;
    };
    error?: string;
  };
  cost?: {
    totalUsd: number;
    inputTokens: number;
    outputTokens: number;
  } | null;
  error: string | null;
  source?: 'console' | 'feedback';
  /**
   * Mirrors `app/src/lib/feedback/category.ts:FeedbackCategory`. debug-console
   * doesn't depend on `@airo/shared` so it keeps an inline literal; if a
   * 4th category is added there, update both sites.
   */
  category?: 'issue' | 'support' | 'feedback';
  rating?: number;
  topics?: string[];
  crmCaseId?: string;
  crmCaseNumber?: string;
}

export interface AcquireLockResult {
  acquired: boolean;
  existing?: InvestigationState;
  tookOverZombie?: boolean;
}

export interface InvestigationKeys {
  stateKey: string;
  resultKey: string;
  historyPrefix: string;
  tracePrefix: string;
}

export interface InvestigationKeysWithEvents extends InvestigationKeys {
  eventsPrefix: string;
}

export function keysFor(customerId: string, appId: string): InvestigationKeys {
  const base = `active/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}`;
  return {
    stateKey: `${base}/state.json`,
    resultKey: `${base}/result.md`,
    historyPrefix: `history/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/`,
    tracePrefix: `${base}/`,
  };
}

// Per-investigation keys including the per-id events prefix. Use this (not
// keysFor) whenever you need to read or write events — scoping the prefix to
// investigationId prevents accidentally listing or fetching another
// investigation's event stream.
export function keysForInvestigation(
  customerId: string,
  appId: string,
  investigationId: string,
): InvestigationKeysWithEvents {
  const base = keysFor(customerId, appId);
  const eventsBase = `events/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}`;
  return {
    ...base,
    eventsPrefix: `${eventsBase}/${investigationId}/`,
  };
}

export type InvestigationEventType =
  | 'investigation.started'
  | 'phase.started'
  | 'log'
  | 'evidence.ready'
  | 'heartbeat'
  | 'report.ready'
  // Non-fatal warning surfaced from the Lambda (e.g. GoCode SSO
  // primary-region failure that fell back to secondary). Investigation
  // continues; operators see it on the SSE stream.
  | 'investigation.warning'
  | 'investigation.completed'
  | 'investigation.failed'
  | 'investigation.killed';

export interface InvestigationEvent {
  v: 1;
  seq: number;
  investigationId: string;
  ts: string;
  type: InvestigationEventType;
  data: Record<string, unknown>;
}

export const TERMINAL_EVENT_TYPES: ReadonlySet<InvestigationEventType> = new Set<InvestigationEventType>([
  'investigation.completed',
  'investigation.failed',
  'investigation.killed',
]);

export function isTerminalEvent(e: InvestigationEvent): boolean {
  return TERMINAL_EVENT_TYPES.has(e.type);
}

export function seqFromKey(key: string): number | null {
  const m = key.match(/\/(\d{6})\.json$/);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

export function eventKey(eventsPrefix: string, seq: number): string {
  return `${eventsPrefix}${String(seq).padStart(6, '0')}.json`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INV_ID_RE = /^[A-Za-z0-9_.-]+$/;

export function keysForSummary(date: string, investigationId: string): string {
  if (!DATE_RE.test(date)) {
    throw new Error(`keysForSummary: date must be yyyy-mm-dd, got "${date}"`);
  }
  if (!investigationId || !INV_ID_RE.test(investigationId)) {
    throw new Error(`keysForSummary: investigationId must match ${INV_ID_RE}`);
  }
  return `summaries/${date}/${investigationId}.json`;
}

// Latest-per-app key: overwritten on each run. Powers the scalable listing
// path — 1 object per (date, appId) regardless of investigation count.
export function keysForLatestSummary(date: string, appId: string): string {
  if (!DATE_RE.test(date)) {
    throw new Error(`keysForLatestSummary: date must be yyyy-mm-dd, got "${date}"`);
  }
  if (!appId) {
    throw new Error('keysForLatestSummary: appId is required');
  }
  // appId is encodeURIComponent'd (prevents path traversal). INV_ID_RE not
  // enforced here because appIds can contain chars outside that set; encoding
  // is the safety mechanism instead of charset restriction.
  return `summaries/latest/${date}/${encodeURIComponent(appId)}.json`;
}

export function keysForSummaryPointer(investigationId: string): string {
  if (!investigationId || !INV_ID_RE.test(investigationId)) {
    throw new Error(`keysForSummaryPointer: investigationId must match ${INV_ID_RE}`);
  }
  return `summaries/_meta/${investigationId}.pointer.json`;
}

export interface SummaryPointer {
  v: 1;
  investigationId: string;
  date: string; // yyyy-mm-dd
  appId: string;
  customerId: string;
}

export interface InvestigationSummary {
  v: 1;
  investigationId: string;
  appId: string;
  customerId: string;
  status: 'completed' | 'failed' | 'killed';
  startedAt: string;
  completedAt: string;
  durationMs: number | null;
  startedBy: string;
  feedbackExcerpt: string;
  fullstoryUrl: string | null;
  reportAvailable: boolean;
  reportSize: number | null;
  reportEtag: string | null;
  evidence: {
    artifactCount: number | null;
    uploadedCount: number | null;
    failedCount: number | null;
  } | null;
  cost: { totalUsd: number; inputTokens: number; outputTokens: number } | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  confidence: number | null;
  rootCause: string | null;
  category: string | null;
  error: string | null;
  schemaCompleted: boolean;
}
