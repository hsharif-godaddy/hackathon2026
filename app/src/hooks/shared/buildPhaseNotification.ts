/**
 * Shared handling for `build_phase` events that advance the Design Kit Wizard
 * stepper.
 *
 * Used by BOTH transports' client paths (WS `BuildPhaseHandler`, SSE
 * `useSSEChat`) so a phase transition produces the same outcome — a wizard
 * store update — regardless of transport. WS is the reference behavior; keep
 * this in lockstep with it.
 */

import { logger } from '@/lib/request-context'
import { useWizardStore, type WizardStep } from '@/stores/useWizardStore'

export function handleBuildPhaseNotification(params: {
  raw: Record<string, unknown>
  clientAppId: string
  logPrefix: string
}): void {
  const { raw, clientAppId, logPrefix } = params
  const eventAppId = typeof raw.appId === 'string' ? raw.appId : clientAppId
  if (eventAppId !== clientAppId) return // ignore events for other apps
  if (!clientAppId) return // no app to scope the wizard store write to

  const step = Number(raw.step)
  if (!Number.isInteger(step) || step < 1 || step > 5) {
    logger.warn(`${logPrefix}.invalid_step`, { appId: clientAppId, step: raw.step })
    return
  }
  useWizardStore.getState().setStep(clientAppId, step as WizardStep)
}
