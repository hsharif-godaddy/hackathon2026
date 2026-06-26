/**
 * Initial Build Funnel Tracking
 *
 * Tracks 5 milestones during the create-flow app build process.
 * Module-level state so both WS and SSE handlers can fire events.
 * Each event fires at most once per session (idempotent).
 */

import { shipAnalyticsLog } from '@/lib/logging'
import { logActionEvent, logImpressionEvent, setInstrumentationIntentCategory } from '@/utils/instrumentation'

let active = false
let questionReceived = false
let handoffSeen = false
let firstViewLogged = false
let buildComplete = false
let postInteractionLogged = false
let funnelAppId: string | null = null
let buildStartedAt: number | null = null

export function activateInitialBuildFunnel(appId: string): void {
  if (active && funnelAppId === appId) return
  if (active && funnelAppId !== appId) {
    resetInitialBuildFunnel()
  }
  active = true
  funnelAppId = appId
  buildStartedAt = Date.now()

  shipAnalyticsLog('funnel.initial_build.started', { appId })
  logImpressionEvent('develop.initialBuild.start', { appId })()
}

export function trackQuestionReceived(): void {
  if (!active || questionReceived) return
  questionReceived = true

  shipAnalyticsLog('funnel.initial_build.question_received', { appId: funnelAppId })
}

export function trackHandoff(): void {
  if (!active || handoffSeen) return
  handoffSeen = true

  shipAnalyticsLog('funnel.initial_build.handoff', { appId: funnelAppId })
  logImpressionEvent('develop.generation.triggered', { appId: funnelAppId ?? '' })()
}

export function trackFirstView(): number | null {
  if (!active || firstViewLogged) return null
  firstViewLogged = true

  const msToFirstView: number | null = buildStartedAt !== null ? Date.now() - buildStartedAt : null
  shipAnalyticsLog('funnel.initial_build.first_view', { appId: funnelAppId, msToFirstView })
  return msToFirstView
}

export function trackBuildComplete(commitHash: string): void {
  if (!active || buildComplete) return
  buildComplete = true

  shipAnalyticsLog('funnel.initial_build.complete', { appId: funnelAppId, commitHash })
  logActionEvent({ eid: 'develop.firstBuild.complete', action: 'load', customProperties: { appId: funnelAppId ?? '' } })()

  // Initial build done — switch intent baseline from 'new_build' to 'edit' for the rest
  // of this session. Persisting to sessionStorage fixes toolSideEffects restore after rebuilds.
  if (funnelAppId) {
    try {
      sessionStorage.setItem(`intent-category-${funnelAppId}`, 'edit')
    } catch {
      // Safari private mode / quota exceeded — non-fatal; in-memory state still correct
    }
    setInstrumentationIntentCategory('edit')
  }
}

export function trackPostInteraction(): void {
  if (!active || !buildComplete || postInteractionLogged) return
  postInteractionLogged = true

  shipAnalyticsLog('funnel.initial_build.post_interaction', { appId: funnelAppId })
}

export function isInitialBuildFunnelActive(): boolean {
  return active
}

export function isInitialBuildComplete(): boolean {
  return buildComplete
}

export function resetInitialBuildFunnel(): void {
  active = false
  questionReceived = false
  handoffSeen = false
  firstViewLogged = false
  buildComplete = false
  postInteractionLogged = false
  funnelAppId = null
  buildStartedAt = null
}
