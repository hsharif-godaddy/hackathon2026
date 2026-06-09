import type { RebuildOrchestrationService } from '../../services/RebuildOrchestrationService.js'
import { isRebuildReadyForUpfrontBuild } from '../../services/rebuild/scrape-completion.js'
import { asRebuildError, type RebuildWorkflowState } from '../../types/rebuild.js'

/**
 * Poll until scrape + analysis are ready for upfront multi-page builds.
 */
export async function waitForScrapeCompletion(
  service: RebuildOrchestrationService,
  appId: string,
  maxWaitMs: number = 300_000,
): Promise<RebuildWorkflowState> {
  const startTime = Date.now()
  let pollIteration = 0

  while (Date.now() - startTime < maxWaitMs) {
    const state = await service.getStatus(appId)

    if (isRebuildReadyForUpfrontBuild(state)) {
      return state
    }

    if (state.status === 'error') {
      throw asRebuildError({
        message: state.error || 'Rebuild failed',
        code: state.errorCode,
        userMessage: state.userMessage,
      })
    }

    const pollMs = pollIteration < 18 ? 400 : 1500
    pollIteration++
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }

  throw new Error('Rebuild timed out waiting for completion')
}
