import { randomUUID } from 'node:crypto'
import { BudgetExceededError } from '@airo/ai-common'

import { logger } from '../../logging/index.js'
import { getSSERegistry } from '../../server/sse/registry-singleton.js'
import { createForWorkspace } from '../../workspace/index.js'
import type { WorkspaceFiles } from '../../workspace/files.js'
import type { MediaSlot } from '../MediaManifestService.js'
import { logoService, type LogoLayout, type LogoSessionResponse, type ProcessedLogo } from '../LogoService.js'
import { readLogoJob, writeLogoJob, type LogoJob } from './logo-job-state.js'
import { ensureShimmerAssets } from './logo-shimmer.js'
import { LOGO_SLOT_PATHS, saveLogoToSlots, snapshotSlots, placeShimmerSlots, revertSlots } from './logo-slots.js'

export interface StartLogoParams {
  appId: string
  prompt: string
  layouts: LogoLayout[]
  referenceUrl?: string
  /** How the logo API should use referenceUrl: 'inspiration' (new logo in the
   *  reference's style, runs the brief) or 'edit' (refine the saved logo,
   *  preserving identity). Ignored when referenceUrl is absent. */
  referenceMode?: 'inspiration' | 'edit'
  colors?: import('../LogoService.js').LogoColors
  customerId: string
  budgetUserId: string
  searchQuery: string
  /** When true, suppress client-visible Growl notifications (the agent presents
   *  the result inline, so a toast would be redundant). */
  suppressGrowl?: boolean
  /** W3C traceparent captured in the media-logo tool's execute() (BEFORE the
   *  setImmediate detach below loses the ambient OTel context). Threaded through
   *  RunContext into logoService.generate() so the logo API anchors its Langfuse
   *  observations under the originating `media-logo__generate_logo` tool span. */
  traceparent?: string
  /** Conversation id of the originating turn, forwarded for Langfuse correlation. */
  conversationId?: string
}

/** Terminal outcome of a background run, resolved through `StartLogoResult.done`
 *  so a synchronous (background:false) caller gets THIS job's result directly,
 *  rather than re-reading the per-app job file (which may describe a newer job). */
export type LogoRunOutcome =
  | {
      status: 'completed'
      jobId: string
      logoId: string
      logo: ProcessedLogo
      sessionId: string
      slotSaveFailed: boolean
      failedLayouts: LogoLayout[]
      skippedLayouts: LogoLayout[]
    }
  | { status: 'failed'; jobId: string; error?: string }
  | { status: 'cancelled'; jobId: string }
  | { status: 'superseded'; jobId: string }

export interface StartLogoResult {
  status: 'queued' | 'error'
  jobId?: string
  slots?: string[]
  error?: string
  /** Resolves with this job's terminal outcome when the background run settles.
   *  Background callers ignore it; synchronous callers and tests await it. */
  done?: Promise<LogoRunOutcome>
}

const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [1000, 3000]

type RunContext = StartLogoParams & {
  jobId: string
  slots: string[]
  previousSlots: Record<string, MediaSlot>
  controller: AbortController
  workspace: WorkspaceFiles
}

/** In-flight bookkeeping kept in memory so cancel/supersede/error paths can
 *  revert slots and emit a terminal event WITHOUT depending on a readable job
 *  file (a supervisor read outage must not leave a slot stuck on the shimmer). */
interface InFlightEntry {
  jobId: string
  controller: AbortController
  slots: string[]
  previousSlots: Record<string, MediaSlot>
  workspace: WorkspaceFiles
}

class LogoGenerationService {
  private readonly inFlight = new Map<string, InFlightEntry>()

  /** True when a logo job is live in memory for this app (a worker holds an
   *  AbortController). When `jobId` is given, the live entry must also match it.
   *  Used by the reconciler + the lazy restart backstop to distinguish a genuinely
   *  running job from an orphan left in `.airo/logo.json` after an agent restart
   *  (where the in-flight Map — memory-only — is empty). Keeps `inFlight` private. */
  isInFlight(appId: string, jobId?: string): boolean {
    const entry = this.inFlight.get(appId)
    if (!entry) return false
    return jobId ? entry.jobId === jobId : true
  }

  async start(params: StartLogoParams): Promise<StartLogoResult> {
    const { appId, layouts } = params
    const workspace = createForWorkspace(appId, 'preview')?.files ?? null
    if (!workspace) {
      logger.error('logo.async.no_workspace', { appId })
      return { status: 'error', error: 'Workspace unavailable for logo generation' }
    }

    // Lazy restart backstop: an agent-container restart leaves the in-flight Map
    // (memory-only) empty while .airo/logo.json may still describe a queued/generating
    // job whose worker is gone — its slot is stuck on a shimmer with a dangling
    // pendingJobId. Reconcile that orphan (revert from its persisted previousSlots,
    // mark it failed) BEFORE we snapshot/place a new shimmer, so a fresh generate
    // after restart clears the orphan instead of stacking a second placeholder. The
    // startup pass in app.ts handles the known workspace(s); this is the per-action
    // backstop. Dynamic import avoids a static import cycle with the reconciler.
    try {
      const onDisk = await readLogoJob(workspace, appId).catch(() => null)
      if (
        onDisk &&
        (onDisk.status === 'queued' || onDisk.status === 'generating') &&
        !this.isInFlight(appId, onDisk.jobId)
      ) {
        logger.info('logo.async.restart_backstop', { appId, staleJobId: onDisk.jobId, status: onDisk.status })
        const { reconcileStaleLogoJob } = await import('./logo-reconciler.js')
        await reconcileStaleLogoJob(appId)
      }
    } catch (err) {
      logger.warn('logo.async.restart_backstop_failed', {
        appId, error: err instanceof Error ? err.message : String(err),
      })
    }

    const slots = layouts.map((l) => LOGO_SLOT_PATHS[l])
    const jobId = randomUUID()

    const existing = this.inFlight.get(appId)
    if (existing) {
      logger.warn('logo.async.superseded_previous', { appId, previousJobId: existing.jobId, newJobId: jobId })
      existing.controller.abort('superseded')
    }

    // Guard the synchronous setup: if shimmer placement or the job write throws,
    // a placeholder may already be on a slot — revert it (best-effort) so the slot
    // doesn't get stuck on the shimmer, and surface a structured error.
    let previousSlots: Record<string, MediaSlot> = {}
    let isRegeneration = false
    try {
      const shimmerByLayout = await ensureShimmerAssets(workspace, appId, layouts)
      const shimmerUrlBySlot: Record<string, string> = {}
      for (const layout of layouts) {
        shimmerUrlBySlot[LOGO_SLOT_PATHS[layout]] = shimmerByLayout[layout]
      }
      const snapshot = await snapshotSlots(appId, slots)
      previousSlots = snapshot.previousSlots
      isRegeneration = snapshot.isRegeneration
      await placeShimmerSlots(appId, slots, jobId, shimmerUrlBySlot, previousSlots)

      const now = new Date().toISOString()
      const job: LogoJob = {
        jobId,
        status: 'queued',
        prompt: params.prompt,
        layouts,
        slots,
        ...(params.referenceUrl ? { referenceUrl: params.referenceUrl } : {}),
        isRegeneration,
        previousSlots,
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      }
      await writeLogoJob(workspace, appId, job)
    } catch (err) {
      logger.error('logo.async.setup_failed', {
        appId, jobId, error: err instanceof Error ? err.message : String(err),
      })
      await revertSlots(appId, { jobId, slots, previousSlots }).catch(() => {})
      return { status: 'error', error: 'Logo generation could not be started' }
    }

    const controller = new AbortController()
    this.inFlight.set(appId, { jobId, controller, slots, previousSlots, workspace })
    logger.info('logo.async.kickoff', {
      appId, jobId, layouts, slots, hasReference: !!params.referenceUrl, isRegeneration,
    })

    // Detach the run onto the next macrotask so start() returns with the job
    // observably in `queued` state before the worker flips it to `generating`
    // (the "kickoff returns immediately" contract). `done` resolves with this
    // job's terminal outcome — background callers ignore it; sync callers/tests await it.
    const done = new Promise<LogoRunOutcome>((resolve) => {
      setImmediate(() => {
        this.run({ ...params, jobId, slots, previousSlots, controller, workspace })
          .then(resolve)
          .catch(async (err) => {
            // Truly unexpected throw (run() handles its known errors internally).
            // Clear the shimmer so the slot isn't stuck forever, then resolve failed.
            logger.error('logo.worker.unhandled', {
              appId, jobId, error: err instanceof Error ? err.message : String(err),
            })
            resolve(await this.fail(appId, jobId, workspace, 0, err, { suppressGrowl: params.suppressGrowl }))
          })
      })
    })

    return { status: 'queued', jobId, slots, done }
  }

  async cancel(appId: string, jobId?: string, opts?: { revert?: boolean }): Promise<{ cancelled: boolean }> {
    const revert = opts?.revert ?? true
    const entry = this.inFlight.get(appId)
    if (!entry || (jobId && entry.jobId !== jobId)) {
      logger.warn('logo.cancel.not_found', { appId, jobId })
      return { cancelled: false }
    }
    logger.info('logo.cancel.received', { appId, jobId: entry.jobId, revert })
    entry.controller.abort('cancelled')
    this.inFlight.delete(appId)

    // Revert from the in-memory snapshot so the slot clears even if the job file
    // is unreadable. revert:false — the caller is about to write the slot itself
    // (manual override), so skip the revert but still emit the terminal signal.
    if (revert) {
      await revertSlots(appId, entry).catch(() => {})
    }
    // Persist the terminal status when the job file is still readable + ours.
    const job = await readLogoJob(entry.workspace, appId).catch(() => null)
    if (job && job.jobId === entry.jobId) {
      await writeLogoJob(entry.workspace, appId, {
        ...job, status: 'cancelled', updatedAt: new Date().toISOString(),
      }).catch(() => {})
    }
    // Always emit a terminal 'cancelled' so the chat/shimmer clears (not gated on
    // a readable job — a read outage must not leave the slot stuck).
    this.emitLogoEvent(appId, { status: 'cancelled', jobId: entry.jobId, slots: entry.slots })
    logger.info('logo.cancel.complete', { appId, jobId: entry.jobId })
    return { cancelled: true }
  }

  private async run(ctx: RunContext): Promise<LogoRunOutcome> {
    const { appId, jobId, slots, controller, workspace } = ctx
    const startedAt = Date.now()

    // Aborted before the worker even started (cancel()/supersede won the race) —
    // cancel()/start() owns the revert + terminal state, so drop without touching
    // the job (don't resurrect a cancelled job back to `generating`).
    if (controller.signal.aborted) {
      logger.info('logo.worker.aborted', { appId, jobId })
      return { status: 'cancelled', jobId }
    }

    const job = await readLogoJob(workspace, appId)
    if (!job || job.jobId !== jobId) {
      logger.warn('logo.worker.superseded_drop', { appId, jobId, currentJobId: job?.jobId })
      return { status: 'superseded', jobId }
    }
    await writeLogoJob(workspace, appId, { ...job, status: 'generating', updatedAt: new Date().toISOString() })
    logger.info('logo.worker.begin', { appId, jobId, attempt: 0 })

    let response: LogoSessionResponse | undefined
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (controller.signal.aborted) {
        logger.info('logo.worker.aborted', { appId, jobId })
        return { status: 'cancelled', jobId } // cancel()/start() owns revert
      }
      try {
        response = await logoService.generate({
          prompt: ctx.prompt,
          layout: ctx.layouts,
          ...(ctx.referenceUrl ? { referenceUrl: ctx.referenceUrl } : {}),
          ...(ctx.referenceMode ? { referenceMode: ctx.referenceMode } : {}),
          ...(ctx.colors ? { colors: ctx.colors } : {}),
          appId,
          customerId: ctx.customerId,
          budgetUserId: ctx.budgetUserId,
          ...(ctx.traceparent ? { traceparent: ctx.traceparent } : {}),
          ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
          signal: controller.signal,
        })
        break
      } catch (err) {
        if (controller.signal.aborted) {
          logger.info('logo.worker.aborted', { appId, jobId })
          return { status: 'cancelled', jobId }
        }
        if (this.isHardError(err) || attempt >= MAX_ATTEMPTS) {
          return this.fail(appId, jobId, workspace, attempt, err, { suppressGrowl: ctx.suppressGrowl })
        }
        const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? 3000
        logger.warn('logo.worker.retry', {
          appId, jobId, attempt, delayMs, reason: err instanceof Error ? err.message : String(err),
        })
        await writeLogoJob(workspace, appId, { ...job, status: 'generating', attempt, updatedAt: new Date().toISOString() })
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
    if (!response) return { status: 'failed', jobId } // defensive — fail() already ran

    // Supersede guard: a newer job may have taken over while we awaited generate().
    const current = await readLogoJob(workspace, appId)
    if (!current || current.jobId !== jobId || controller.signal.aborted) {
      logger.warn('logo.worker.superseded_drop', { appId, jobId, currentJobId: current?.jobId })
      return controller.signal.aborted ? { status: 'cancelled', jobId } : { status: 'superseded', jobId }
    }

    const { savedSlots, slotSaveFailed, failedLayouts, skippedLayouts } = await saveLogoToSlots(
      appId, response, ctx.searchQuery, jobId,
    )
    logger.info('logo.worker.slots_saved', {
      appId, jobId, slots, savedSlots: Object.keys(savedSlots), droppedLayouts: failedLayouts, skippedLayouts,
    })

    // Re-check AFTER the save: a cancel/supersede can land while saveLogoToSlots
    // is awaiting. Without this, we'd announce the logo as ready and leave the
    // just-saved logo in place even though the user cancelled. Revert + defer to
    // the terminal owner (cancel()/the newer job) instead of writing `completed`.
    const afterSave = await readLogoJob(workspace, appId)
    if (controller.signal.aborted || !afterSave || afterSave.jobId !== jobId) {
      logger.warn('logo.worker.cancelled_during_save', {
        appId, jobId, aborted: controller.signal.aborted, currentJobId: afterSave?.jobId,
      })
      // The save overwrote the slots; undo it back to this job's prior snapshot
      // (cancel() may also revert — revertSlots is idempotent and supersede-safe).
      await revertSlots(appId, { jobId, slots, previousSlots: ctx.previousSlots }).catch(() => {})
      return controller.signal.aborted ? { status: 'cancelled', jobId } : { status: 'superseded', jobId }
    }

    await writeLogoJob(workspace, appId, {
      ...current,
      status: 'completed',
      sessionId: response.sessionId,
      logoId: response.logo.id,
      updatedAt: new Date().toISOString(),
    })
    if (this.inFlight.get(appId)?.jobId === jobId) this.inFlight.delete(appId)

    this.emitLogoEvent(appId, {
      status: 'completed',
      jobId,
      slots,
      slotSaveFailed,
      failedLayouts,
      skippedLayouts,
      logoId: response.logo.id,
      logo: response.logo,
      ...(ctx.suppressGrowl ? { suppressGrowl: true } : {}),
    })
    logger.info('logo.worker.complete', {
      appId, jobId, sessionId: response.sessionId, logoId: response.logo.id, durationMs: Date.now() - startedAt,
    })
    return { status: 'completed', jobId, logoId: response.logo.id, logo: response.logo, sessionId: response.sessionId, slotSaveFailed, failedLayouts, skippedLayouts }
  }

  private async fail(
    appId: string, jobId: string, workspace: WorkspaceFiles, attempt: number, err: unknown, opts?: { suppressGrowl?: boolean },
  ): Promise<LogoRunOutcome> {
    const errorKind = BudgetExceededError.isInstance(err) ? 'budget' : 'error'
    const message = err instanceof Error ? err.message : String(err)
    logger.error('logo.worker.failed', { appId, jobId, attempt, errorKind, error: message })

    // Best-effort read; a supervisor read outage must not stop us clearing the shimmer.
    const job = await readLogoJob(workspace, appId).catch(() => null)
    const entry = this.inFlight.get(appId)
    const silentFlag = opts?.suppressGrowl ? { suppressGrowl: true } : {}
    if (job && job.jobId === jobId) {
      await revertSlots(appId, job).catch(() => {})
      await writeLogoJob(workspace, appId, { ...job, status: 'failed', error: message, updatedAt: new Date().toISOString() }).catch(() => {})
      this.emitLogoEvent(appId, { status: 'failed', jobId, slots: job.slots, error: message, errorKind, ...silentFlag })
    } else if (entry && entry.jobId === jobId) {
      // Job file missing/superseded but this job is still the in-flight owner —
      // revert + emit from the in-memory snapshot so the slot clears regardless.
      await revertSlots(appId, entry).catch(() => {})
      this.emitLogoEvent(appId, { status: 'failed', jobId, slots: entry.slots, error: message, errorKind, ...silentFlag })
    }
    if (this.inFlight.get(appId)?.jobId === jobId) this.inFlight.delete(appId)
    return { status: 'failed', jobId, error: message }
  }

  /** 402 budget is non-retryable; 408/429 (timeout/rate-limit) and 5xx/network
   *  retry; other 4xx are non-retryable client errors. */
  private isHardError(err: unknown): boolean {
    if (BudgetExceededError.isInstance(err)) return true
    const message = err instanceof Error ? err.message : String(err)
    if (/status 408|status 429/.test(message)) return false
    return /status 4\d\d/.test(message)
  }

  /** Public terminal-event entrypoint for the reconciler, which has no access to
   *  the private emit path but must surface the same SSE `logo` event after it
   *  reverts an interrupted job's slots. Delegates to the single emit implementation. */
  emitTerminalEvent(appId: string, data: Record<string, unknown>): void {
    this.emitLogoEvent(appId, data)
  }

  private emitLogoEvent(appId: string, data: Record<string, unknown>): void {
    const eventData = { ...data, appId }
    const sse = getSSERegistry()
    if (sse) {
      sse.sendToApp(appId, 'logo', eventData)
      logger.debug('logo.emit.sse', { appId, status: data.status, jobId: data.jobId })
    } else {
      logger.warn('logo.emit.no_targets', { appId, status: data.status, jobId: data.jobId })
    }
  }
}

export const logoGenerationService = new LogoGenerationService()
