import { Logger } from '../../logging/index.js'
import type { RebuildOrchestrationService } from '../../services/RebuildOrchestrationService.js'
import { asRebuildError, type RebuildWorkflowState } from '../../types/rebuild.js'

const logger = Logger.create({ component: 'website-rebuild-tool' })

export const INTAKE_WAIT_MS = 600_000

export type WaitForIntakeResult = {
  state: RebuildWorkflowState
  intakeTimedOut: boolean
}

/**
 * Poll until user submits intake or timeout applies defaults.
 */
export interface WaitForIntakeOptions {
  /** Homepage modal design direction, applied if the intake times out. */
  designDirection?: unknown
  /** Customer free-text design intent, applied if the intake times out so a
   * typed "reimagine from scratch" survives the fallback (AIROBUILD-2682). */
  designIntent?: unknown
  maxWaitMs?: number
}

export async function waitForIntake(
  service: RebuildOrchestrationService,
  appId: string,
  options: WaitForIntakeOptions = {},
): Promise<WaitForIntakeResult> {
  const { designDirection, designIntent, maxWaitMs = INTAKE_WAIT_MS } = options
  const startTime = Date.now()
  let pollIteration = 0

  while (Date.now() - startTime < maxWaitMs) {
    const state = await service.getStatus(appId)

    if (state.intakeCompleted) {
      return { state, intakeTimedOut: false }
    }

    if (state.status === 'error') {
      throw asRebuildError({
        message: state.error || 'Rebuild failed',
        code: state.errorCode,
        userMessage: state.userMessage
      })
    }

    if (state.status !== 'awaiting_intake') {
      return { state, intakeTimedOut: false }
    }

    const pollMs = pollIteration < 18 ? 400 : 1500
    pollIteration++
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }

  logger.warn('websiteRebuild.intake-timeout', { appId })

  const latest = await service.getStatus(appId)
  if (latest.intakeCompleted || latest.status !== 'awaiting_intake') {
    return { state: latest, intakeTimedOut: false }
  }

  try {
    return {
      state: await service.submitDefaultIntake(appId, designDirection, designIntent),
      intakeTimedOut: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Cannot submit intake')) {
      const recovered = await service.getStatus(appId)
      if (recovered.intakeCompleted || recovered.status !== 'awaiting_intake') {
        return { state: recovered, intakeTimedOut: false }
      }
    }
    throw error
  }
}
