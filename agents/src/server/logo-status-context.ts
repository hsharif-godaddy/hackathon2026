import { logger } from '../logging/index.js'
import { createForWorkspace } from '../workspace/index.js'
import { readLogoJob } from '../services/logo/logo-job-state.js'
import type { ContextMessage } from './context-builders.js'

/** Inject the current logo-job status (from .airo/logo.json) into the agent's
 *  ambient context so it can answer status questions without guessing. */
export async function buildLogoStatusContextMessage(opts: { appId: string }): Promise<ContextMessage | null> {
  const { appId } = opts
  if (!appId) return null
  try {
    const workspace = createForWorkspace(appId, 'preview')?.files ?? null
    if (!workspace) return null
    const job = await readLogoJob(workspace, appId)
    if (!job) return null

    let line: string
    switch (job.status) {
      case 'queued':
      case 'generating':
        line = `Logo generation is currently in progress (status: ${job.status}). The requested layouts (${job.slots.join(', ')}) are showing an animated placeholder and will update automatically when ready. Do not tell the user the logo is finished yet.`
        break
      case 'completed':
        line = `The most recent logo generation completed successfully for: ${job.slots.join(', ')}.`
        break
      case 'failed':
        line = `The most recent logo generation FAILED${job.error ? ` (${job.error})` : ''}. Offer to try generating it again.`
        break
      case 'cancelled':
        line = `The most recent logo generation was cancelled by the user; the previous logo (if any) was restored.`
        break
      default:
        return null
    }

    logger.debug('logo.status.context_inject', { appId, status: job.status, jobId: job.jobId })
    return { role: 'user', content: `## Logo\n- ${line}`, insertionOrder: 'after_history' }
  } catch (err) {
    logger.warn('logo.status.context_failed', {
      appId, error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
