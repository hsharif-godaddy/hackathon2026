/**
 * Initial Build Funnel Tracking
 *
 * Tracks 5 milestones during the create-flow app build process.
 * Module-level state so both WS and SSE handlers can fire events.
 * Each event fires at most once per session (idempotent).
 */

import { shipAnalyticsLog } from '@/lib/logging'
import { logActionEvent, logImpressionEvent } from '@/utils/instrumentation'

let active = false
let questionReceived = false
let handoffSeen = false
let buildComplete = false
let postInteractionLogged = false
let funnelAppId: string | null = null

export function activateInitialBuildFunnel(appId: string): void {
  if (active && funnelAppId === appId) return
  if (active && funnelAppId !== appId) {
    resetInitialBuildFunnel()
  }
  active = true
  funnelAppId = appId

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
}

export function trackBuildComplete(commitHash: string): void {
  if (!active || buildComplete) return
  buildComplete = true

  shipAnalyticsLog('funnel.initial_build.complete', { appId: funnelAppId, commitHash })
  logActionEvent({ eid: 'develop.firstBuild.complete', action: 'custom', customProperties: { appId: funnelAppId ?? '' } })()
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
  buildComplete = false
  postInteractionLogged = false
  funnelAppId = null
}
