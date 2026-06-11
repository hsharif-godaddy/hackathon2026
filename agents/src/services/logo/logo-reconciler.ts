import { logger } from '../../logging/index.js'
import { createForWorkspace } from '../../workspace/index.js'
import { appRepository } from '../../database/repositories/index.js'
import { mediaManifestService } from '../MediaManifestService.js'
import { readLogoJob, writeLogoJob } from './logo-job-state.js'
import { revertSlots } from './logo-slots.js'
import { isShimmerUrl } from './logo-shimmer.js'
import { logoGenerationService } from './LogoGenerationService.js'

const INTERRUPTED_ERROR = 'Logo generation was interrupted (agent restarted).'

/**
 * Reconcile a single app's persisted logo job if it is stale.
 *
 * The in-flight Map + AbortControllers in LogoGenerationService live only in
 * memory, so an agent-container restart orphans any job left at `queued` or
 * `generating` in `.airo/logo.json`: the slot keeps its shimmer placeholder and a
 * dangling `pendingJobId`, and no worker will ever emit a terminal event. This
 * reverts that orphan from its persisted `previousSlots` snapshot (or strips the
 * fresh placeholder when there was no prior logo — `revertSlots` does both and is
 * supersede-safe), marks the job `failed`, and emits a terminal `failed` event so
 * any connected client clears its in-progress UI.
 *
 * No-ops when:
 *   - the workspace is unavailable (PaaS: no app record → `createForWorkspace`
 *     returns null) — never assume a workspace exists,
 *   - there is no job file,
 *   - the job is already terminal (completed/failed/cancelled),
 *   - the job is genuinely live in memory (`isInFlight`).
 */
export async function reconcileStaleLogoJob(appId: string): Promise<void> {
  const workspace = createForWorkspace(appId, 'preview')?.files ?? null
  if (!workspace) {
    logger.debug('logo.reconcile.no_workspace', { appId })
    return
  }

  const job = await readLogoJob(workspace, appId).catch(() => null)
  if (!job) return
  if (job.status !== 'queued' && job.status !== 'generating') return
  if (logoGenerationService.isInFlight(appId, job.jobId)) {
    logger.debug('logo.reconcile.still_live', { appId, jobId: job.jobId })
    return
  }

  logger.info('logo.reconcile.stale_job', {
    appId, jobId: job.jobId, status: job.status, isRegeneration: job.isRegeneration,
  })

  await revertSlots(appId, job).catch((err: unknown) => {
    logger.warn('logo.reconcile.revert_failed', {
      appId, jobId: job.jobId, error: err instanceof Error ? err.message : String(err),
    })
  })

  await writeLogoJob(workspace, appId, {
    ...job,
    status: 'failed',
    error: INTERRUPTED_ERROR,
    updatedAt: new Date().toISOString(),
  }).catch((err: unknown) => {
    logger.warn('logo.reconcile.write_failed', {
      appId, jobId: job.jobId, error: err instanceof Error ? err.message : String(err),
    })
  })

  // Best-effort terminal signal — at boot there may be no connected client yet
  // (wsDelivered 0). The durable signal is the cleaned slot + `failed` job file
  // that buildLogoStatusContextMessage and the app frontend read on next load.
  try {
    logoGenerationService.emitTerminalEvent(appId, {
      status: 'failed', jobId: job.jobId, slots: job.slots, error: INTERRUPTED_ERROR, errorKind: 'error',
    })
  } catch (err) {
    logger.warn('logo.reconcile.emit_failed', {
      appId, jobId: job.jobId, error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Reconcile every app's stale logo job (called once at agent startup). Per-app
 * errors are swallowed so one bad workspace can't abort the whole pass.
 *
 * Prod deploys one app per container; local dev may have many — both are covered
 * by `appRepository.findAll()` (default limit 50). Orphans on apps beyond the cap
 * are still caught lazily in `LogoGenerationService.start()`, so the cap is a soft
 * limit, not a correctness hole.
 */
export async function reconcileAllStaleLogoJobs(): Promise<void> {
  const apps = appRepository.findAll()
  logger.info('logo.reconcile.startup_pass', { appCount: apps.length })
  for (const app of apps) {
    try {
      await reconcileStaleLogoJob(app.id)
    } catch (err) {
      logger.warn('logo.reconcile.app_failed', {
        appId: app.id, error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Pre-publish guard: ensure no slot in the committed media manifest still carries
 * a `pendingJobId` (shimmer placeholder / mid-regeneration), so the published
 * archive never ships an in-progress placeholder. The manifest (airo-media.json)
 * is committed and git-archived by the publish strategy's `prepareBuild`; running
 * this BEFORE `prepareBuild` lets the revert's manifest write + commit be picked up
 * by that merge/commit. Pure revert/strip — we do NOT synthesize a wordmark.
 *
 * For each pending slot:
 *   - still in flight → `cancel(appId, pendingJobId, { revert: true })` reverts from
 *     the in-memory snapshot,
 *   - orphaned (not in flight, e.g. after a restart) → `reconcileStaleLogoJob` reverts
 *     from the persisted `previousSlots`.
 *
 * Best-effort: never fails the publish.
 */
export async function reconcilePendingLogoSlotsForPublish(appId: string): Promise<void> {
  try {
    const result = await mediaManifestService.getManifest(appId)
    if (!result.success || !result.manifest) {
      logger.debug('logo.reconcile.publish_no_manifest', { appId })
      return
    }

    const pendingSlots: { slotPath: string; pendingJobId: string }[] = []
    for (const [slotPath, slot] of Object.entries(result.manifest)) {
      if (slot.pendingJobId) {
        pendingSlots.push({ slotPath, pendingJobId: slot.pendingJobId })
      }
    }
    if (pendingSlots.length === 0) return

    logger.info('logo.reconcile.publish_pending_slots', {
      appId, pendingSlots: pendingSlots.map((s) => s.slotPath),
    })

    // Pass 1: cancel any genuinely live job (reverts from its in-memory snapshot),
    // and reconcile the persisted job file once for orphans (reverts the slots IT
    // owns + marks the job failed for status context). reconcileStaleLogoJob is
    // job-FILE-centric — it only clears slots whose pendingJobId matches the current
    // job file — so a marker that doesn't match (terminal/missing/newer job file) is
    // handled by the guaranteed strip pass below, not here.
    let reconciledJobFile = false
    for (const { slotPath, pendingJobId } of pendingSlots) {
      if (logoGenerationService.isInFlight(appId, pendingJobId)) {
        await logoGenerationService.cancel(appId, pendingJobId, { revert: true })
        logger.info('logo.reconcile.publish_cancelled_live', { appId, jobId: pendingJobId, slotPath })
      } else if (!reconciledJobFile) {
        reconciledJobFile = true
        await reconcileStaleLogoJob(appId)
        logger.info('logo.reconcile.publish_reverted_orphan', { appId, jobId: pendingJobId, slotPath })
      }
    }

    // Pass 2 (guaranteed strip): re-read each pending slot. If it STILL carries a
    // pendingJobId — its marker didn't match the job file, the file was missing or
    // terminal, or revert skipped it as superseded — clear it directly so the
    // committed manifest never archives an in-progress placeholder. A shimmer
    // placeholder (or empty slot) is removed outright; a real logo that merely has a
    // dangling marker keeps the logo and drops only the marker. No wordmark synthesis.
    for (const { slotPath } of pendingSlots) {
      const after = await mediaManifestService.getSlot(appId, slotPath)
      if (!after.success || !after.slot?.pendingJobId) continue
      const slot = after.slot
      if (!slot.currentUrl || isShimmerUrl(slot.currentUrl)) {
        await mediaManifestService.removeSlot(appId, slotPath)
        logger.warn('logo.reconcile.publish_stripped_placeholder', {
          appId, slotPath, pendingJobId: slot.pendingJobId,
        })
      } else {
        const { pendingJobId: _pendingJobId, ...clean } = slot
        await mediaManifestService.setSlot(appId, slotPath, clean)
        logger.warn('logo.reconcile.publish_cleared_marker', {
          appId, slotPath, pendingJobId: slot.pendingJobId,
        })
      }
    }
  } catch (err) {
    logger.warn('logo.reconcile.publish_guard_failed', {
      appId, error: err instanceof Error ? err.message : String(err),
    })
  }
}
