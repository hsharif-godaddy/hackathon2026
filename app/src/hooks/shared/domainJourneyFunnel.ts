/**
 * Domain Journey Funnel Tracking (AIROBUILD-3259)
 *
 * Tracks the full domain flow — search → select → cart → purchase → connect →
 * active — as a single funnel keyed by one `domainJourneyId`. Each milestone
 * carries timing (`durationFromStartMs`, `durationFromPrevMilestoneMs`), an
 * `outcome` (success/failure/timeout), and context (`appId`, `fqdn`,
 * `conversationId`, `errorType`). Events fan out to BOTH Elasticsearch (via
 * `shipAnalyticsLog`) and FullStory (via `JourneyTracker`) so P95/P99 latency
 * and per-step failure rates are computable downstream.
 *
 * Modeled on the sibling funnels `initialBuildFunnel.ts` / `paymentFunnel.ts`:
 * module-level singleton state so every widget in the flow shares one instance,
 * `Date.now()` read inside functions (never at import — keeps timing testable
 * with fake timers), and an exported `resetDomainJourneyFunnel()` for tests.
 *
 * Unlike those funnels, the connect phase can outlive a full page reload (an
 * attach triggers a redeploy), so the journey is mirrored to sessionStorage and
 * rehydrated on the next call for that appId — purchase→connect stays one
 * stitched journey.
 */

import { JourneyTracker } from '@/lib/journeyTracker'
import { shipAnalyticsLog } from '@/lib/logging'

export type DomainJourneyOutcome = 'success' | 'failure' | 'timeout'

export interface DomainJourneyContext {
  appId?: string | null
  fqdn?: string | null
  conversationId?: string | null
  errorType?: string | null
}

export type DomainJourneyMilestone =
  | 'started'
  | 'search_triggered'
  | 'search_completed'
  | 'selection_made'
  | 'cart_added'
  | 'purchase_completed'
  | 'purchase_failed'
  | 'connect_started'
  | 'connect_step'
  | 'connect_completed'
  | 'connect_failed'

type DomainJourneyPayloadContext = DomainJourneyContext & Record<string, unknown>

interface PersistedJourney {
  domainJourneyId: string
  startedAt: number | null
  lastMilestoneAt: number | null
  appId: string | null
}

// Module-level singleton state. `let` is the sanctioned exception here (matches
// the sibling funnels) — a single shared instance must survive across the
// widgets that make up one domain flow.
let domainJourneyId: string | null = null
let funnelAppId: string | null = null
let startedAt: number | null = null
let lastMilestoneAt: number | null = null
let lastConnectSubStep: string | null = null

function mintJourneyId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `dj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sessionKey(appId: string | null | undefined): string | null {
  return appId ? `domain-journey-${appId}` : null
}

function persistToSession(): void {
  const key: string | null = sessionKey(funnelAppId)
  if (!key || domainJourneyId == null) return
  try {
    if (typeof sessionStorage === 'undefined') return
    const snapshot: PersistedJourney = { domainJourneyId, startedAt, lastMilestoneAt, appId: funnelAppId }
    sessionStorage.setItem(key, JSON.stringify(snapshot))
  } catch {
    // Safari private mode / quota exceeded / SSR — non-fatal; in-memory state is still correct.
  }
}

function clearSession(appId: string | null): void {
  const key: string | null = sessionKey(appId)
  if (!key) return
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.removeItem(key)
  } catch {
    // non-fatal
  }
}

function readSession(appId: string | null | undefined): PersistedJourney | null {
  const key: string | null = sessionKey(appId)
  if (!key) return null
  try {
    if (typeof sessionStorage === 'undefined') return null
    const raw: string | null = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed: PersistedJourney = JSON.parse(raw) as PersistedJourney
    if (parsed && typeof parsed.domainJourneyId === 'string') return parsed
    return null
  } catch {
    return null
  }
}

function resetState(): void {
  domainJourneyId = null
  funnelAppId = null
  startedAt = null
  lastMilestoneAt = null
  lastConnectSubStep = null
}

function rehydrateForApp(appId: string | null | undefined): boolean {
  if (!appId) return false
  const persisted: PersistedJourney | null = readSession(appId)
  if (!persisted) return false
  domainJourneyId = persisted.domainJourneyId
  funnelAppId = appId
  startedAt = persisted.startedAt
  lastMilestoneAt = persisted.lastMilestoneAt
  lastConnectSubStep = null
  return true
}

/**
 * Ensure a journey exists before emitting a mid-funnel milestone. Rehydrates a
 * persisted journey when possible; otherwise mints silently (no `started`
 * emit) so an out-of-order milestone is never dropped.
 */
function ensureJourney(ctx: DomainJourneyContext): void {
  if (domainJourneyId != null) {
    if (ctx.appId != null && ctx.appId !== funnelAppId) {
      clearSession(funnelAppId)
      resetState()
    } else {
      return
    }
  }
  const appId: string | null = ctx.appId ?? funnelAppId
  if (rehydrateForApp(appId)) return
  domainJourneyId = mintJourneyId()
  funnelAppId = appId
  startedAt = Date.now()
  lastMilestoneAt = null
  lastConnectSubStep = null
}

function emit(milestone: DomainJourneyMilestone, outcome: DomainJourneyOutcome, ctx: DomainJourneyPayloadContext = {}): void {
  const now: number = Date.now()
  const durationFromStartMs: number | null = startedAt == null ? null : now - startedAt
  const durationFromPrevMilestoneMs: number | null = lastMilestoneAt == null ? null : now - lastMilestoneAt
  lastMilestoneAt = now
  persistToSession()

  const payload: Record<string, unknown> = {
    domainJourneyId,
    milestone,
    outcome,
    durationFromStartMs,
    durationFromPrevMilestoneMs,
    fqdn: null,
    conversationId: null,
    errorType: null,
    ...ctx,
    appId: ctx.appId ?? funnelAppId,
  }

  shipAnalyticsLog(`funnel.domain.${milestone}`, payload)
  JourneyTracker.current()?.trackMilestone(`domain.${milestone}`, payload)
}

/**
 * Start (or reuse) the domain journey and emit `funnel.domain.started`.
 * Idempotent per appId: an in-memory or persisted journey for the same app is
 * reused without re-emitting `started`. A different appId starts fresh.
 */
export function startDomainJourney(ctx: DomainJourneyContext): string {
  const appId: string | null = ctx.appId ?? null

  if (funnelAppId != null && appId != null && funnelAppId !== appId) {
    clearSession(funnelAppId)
    resetState()
  }

  if (domainJourneyId != null && (funnelAppId === appId || appId == null)) {
    return domainJourneyId
  }

  if (rehydrateForApp(appId) && domainJourneyId != null) {
    return domainJourneyId
  }

  domainJourneyId = mintJourneyId()
  funnelAppId = appId
  startedAt = Date.now()
  lastMilestoneAt = null
  lastConnectSubStep = null
  emit('started', 'success', { ...ctx })
  return domainJourneyId
}

/** Read the current journey id (rehydrating from sessionStorage if needed) without emitting. */
export function getDomainJourneyId(appId?: string | null): string | null {
  if (domainJourneyId == null) {
    rehydrateForApp(appId ?? funnelAppId)
  }
  if (domainJourneyId != null && appId != null && funnelAppId !== appId) {
    return null
  }
  return domainJourneyId
}

/** Emit any funnel milestone with an explicit outcome and optional extra context. */
export function trackDomainMilestone(
  milestone: DomainJourneyMilestone,
  outcome: DomainJourneyOutcome,
  ctx: DomainJourneyPayloadContext = {}
): void {
  ensureJourney(ctx)
  emit(milestone, outcome, ctx)
}

/**
 * Emit a connect sub-step (`funnel.domain.connect_step`), deduped so it fires
 * only when the mgmt-airo job step actually changes.
 */
export function trackDomainConnectStep(subStep: string, ctx: DomainJourneyContext = {}): void {
  if (!subStep || subStep === lastConnectSubStep) return
  ensureJourney(ctx)
  lastConnectSubStep = subStep
  emit('connect_step', 'success', { ...ctx, subStep })
}

/**
 * Emit a terminal milestone. `connect_completed` (the true success terminal)
 * clears the journey so the next domain flow mints a fresh id; failure
 * milestones emit but do not reset, so a retry stays in one journey.
 */
export function finishDomainJourney(
  milestone: 'connect_completed' | 'connect_failed' | 'purchase_failed',
  outcome: DomainJourneyOutcome,
  ctx: DomainJourneyPayloadContext = {}
): void {
  ensureJourney(ctx)
  emit(milestone, outcome, ctx)
  if (milestone === 'connect_completed') {
    clearSession(ctx.appId ?? funnelAppId)
    resetState()
  }
}

/** Test-only: clear module state and the persisted journey for the active app. */
export function resetDomainJourneyFunnel(): void {
  clearSession(funnelAppId)
  resetState()
}
