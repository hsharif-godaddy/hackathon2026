/**
 * Shared handling for `build_phase` events that drive the Design Kit Wizard phase.
 *
 * Used by the SSE client path (`useSSEChat`) so a phase transition produces the
 * same outcome — a wizard store update — regardless of caller. The agent emits
 * `gathering` at session start and `working` once the kit is assembled; the
 * `ready` phase is driven client-side from the real build-completion signal.
 */

import { logger } from '@/lib/request-context'
import { useWizardStore, type WizardPhase } from '@/stores/useWizardStore'

const VALID_PHASES: readonly WizardPhase[] = ['gathering', 'working', 'ready']

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
  useWizardStore.getState().setPhase(clientAppId, raw.phase)
}
