/**
 * Shared handling for `build_phase` events that drive the Design Kit Wizard phase.
 *
 * Used by the SSE client path (`useSSEChat`) so a phase transition produces the
 * same outcome — a wizard store update — regardless of caller. The agent emits
 * `gathering` at session start, `brand` once the kit is assembled, `website` at the
 * website handoff, and `ready` once the build actually finishes.
 *
 * A live `ready` event (this handler only runs for real SSE `build_phase` events, never for
 * resume hydration) that follows a build phase also fires the one-shot build-complete
 * celebration — the sole trigger, so the overlay is driven by the genuine completion event
 * rather than derived render state (which can't tell a live finish from a resume).
 */

import { logger } from '@/lib/request-context'
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore'

const VALID_PHASES: readonly WizardPhase[] = ['gathering', 'brand', 'website', 'ready']

function isWizardPhase(value: unknown): value is WizardPhase {
  return typeof value === 'string' && (VALID_PHASES as readonly string[]).includes(value)
}

export function handleBuildPhaseNotification(params: {
  raw: Record<string, unknown>
  clientAppId: string
  logPrefix: string
}): void {
  const { raw, clientAppId, logPrefix } = params
  const eventAppId = typeof raw.appId === 'string' ? raw.appId : clientAppId
  if (eventAppId !== clientAppId) return // ignore events for other apps
  if (!clientAppId) return // no app to scope the wizard store write to

  if (!isWizardPhase(raw.phase)) {
    logger.warn(`${logPrefix}.invalid_phase`, { appId: clientAppId, phase: raw.phase })
    return
  }
  const store = useWizardStore.getState()
  const prevPhase = store.phaseByApp[clientAppId]
  store.setPhase(clientAppId, raw.phase)

  // The website build just finished: fire the one-shot celebration. Guarded on a prior
  // non-`ready` phase so a session that only ever sees `ready` (e.g. a resumed finished
  // build whose first event is `ready`) can't celebrate.
  if (raw.phase === 'ready' && prevPhase !== undefined && prevPhase !== 'ready') {
    store.triggerCelebration(clientAppId)
  }
}
