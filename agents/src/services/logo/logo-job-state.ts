import { logger } from '../../logging/index.js'
import { isDevSupervisorNotFound } from '../DevSupervisorClient.js'
import type { WorkspaceFiles } from '../../workspace/files.js'
import type { MediaSlot } from '../MediaManifestService.js'
import type { LogoLayout } from '../LogoService.js'

export const LOGO_JOB_PATH = '.airo/logo.json'

export type LogoJobStatus = 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled'

export interface LogoJob {
  jobId: string
  status: LogoJobStatus
  prompt: string
  layouts: LogoLayout[]
  /** Slot paths this job owns (derived from layouts, e.g. ['logo/horizontal']). */
  slots: string[]
  references?: { logo?: string; inspiration?: string[] }
  /** True when any target slot already held a real logo (snapshot taken). */
  isRegeneration: boolean
  /** Full prior slot snapshot, keyed by slot path, for cancel/failure revert. */
  previousSlots: Record<string, MediaSlot>
  attempt: number
  sessionId?: string
  logoId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

/** Read .airo/logo.json. Returns null when no job file exists. Rethrows any
 *  non-not_found error so a supervisor outage isn't masked as "no job". */
export async function readLogoJob(workspace: WorkspaceFiles, appId: string): Promise<LogoJob | null> {
  try {
    const content: string = await workspace.readText({ path: LOGO_JOB_PATH })
    return JSON.parse(content) as LogoJob
  } catch (err) {
    if (isDevSupervisorNotFound(err)) return null
    logger.warn('logo.metadata.read_error', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function writeLogoJob(workspace: WorkspaceFiles, appId: string, job: LogoJob): Promise<void> {
  await workspace.write({ path: LOGO_JOB_PATH, content: JSON.stringify(job, null, 2) })
  logger.debug('logo.metadata.write', {
    appId, jobId: job.jobId, status: job.status, attempt: job.attempt,
  })
}
