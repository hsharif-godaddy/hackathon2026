import { randomUUID } from 'node:crypto'
import { BudgetExceededError } from '@airo/ai-common'

import { logger } from '../../logging/index.js'
import { getSSERegistry } from '../../server/sse/registry-singleton.js'
import { createForWorkspace } from '../../workspace/index.js'
import type { WorkspaceFiles } from '../../workspace/files.js'
import { mediaManifestService, type MediaSlot } from '../MediaManifestService.js'
import { logoService, type LogoLayout, type LogoVariant, type LogoSessionResponse, type ProcessedLogo } from '../LogoService.js'
import { readLogoJob, writeLogoJob, type LogoJob } from './logo-job-state.js'
import { ensureShimmerAsset, ensureShimmerAssets, LOGO_SHIMMER_SLOT_URLS } from './logo-shimmer.js'
import { LOGO_SLOT_PATHS, FAVICON_SLOT_PATH, ALL_LOGO_SLOT_PATHS, saveLogoToSlots, saveSingleLogoSlot, snapshotSlots, placeShimmerSlots, revertSlots } from './logo-slots.js'

export interface StartLogoParams {
  appId: string
  prompt: string
  layouts: LogoLayout[]
  references?: {
    logo?: string
    inspiration?: string[]
  }
  colors?: import('../LogoService.js').LogoColors
  brandName?: string
  customerId: string
  budgetUserId: string
  searchQuery: string
  /** When true, suppress client-visible Growl notifications (the agent presents
   *  the result inline, so a toast would be redundant). */
  suppressGrowl?: boolean
  /** W3C traceparent captured in the media-logo tool's execute() (BEFORE the
   *  setImmediate detach below loses the ambient OTel context). Forwarded to the
   *  logo v3 API so it anchors its Langfuse observations under the tool span. */
  traceparent?: string
  /** Conversation id of the originating turn, forwarded for Langfuse correlation. */
  conversationId?: string
  /** Variants to auto-derive after this logo finishes (e.g. favicon). Each fires
   *  a sequential background startVariant() call after the main job completes. */
  followUpVariants?: LogoVariant[]
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
  /** Resolves when all chained follow-up variants settle (parallel).
   *  Only present when followUpVariants were requested and the primary succeeded. */
  chainDone?: Promise<LogoRunOutcome[]>
}

export interface StartVariantParams {
  appId: string
  sourceUrl: string
  variant: LogoVariant
  brandName?: string
  prompt?: string
  colors?: import('../LogoService.js').LogoColors
  customerId: string
  budgetUserId: string
  suppressGrowl?: boolean
  traceparent?: string
  conversationId?: string
}

const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [1000, 3000]

interface RevertContext {
  slots: string[]
  previousSlots: Record<string, MediaSlot>
}

interface ChainDeferred {
  promise: Promise<LogoRunOutcome[]>
  resolve: (outcomes: LogoRunOutcome[]) => void
}

type RunContext = StartLogoParams & {
  jobId: string
  slots: string[]
  previousSlots: Record<string, MediaSlot>
  controller: AbortController
  workspace: WorkspaceFiles
  chainDeferred?: ChainDeferred
}

type VariantRunContext = StartVariantParams & {
  jobId: string
  slotPath: string
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

/** Per-variant dedup + slot-level supersession. Keyed by
 *  `appId::variant::sourceUrl::prompt` so identical concurrent requests
 *  return the same promise and different-params requests for the same slot
 *  abort the previous job. */
interface ActiveVariantEntry {
  jobId: string
  controller: AbortController
  done: Promise<LogoRunOutcome>
  result: StartLogoResult
}

class LogoGenerationService {
  private readonly inFlight = new Map<string, InFlightEntry>()
  private readonly activeVariants = new Map<string, ActiveVariantEntry>()

  /** True when a logo job is live in memory for this app (a worker holds an
   *  AbortController). When `jobId` is given, the live entry must also match it.
   *  Checks both primary (`inFlight`) and variant (`activeVariants`) maps.
   *  Used by the reconciler + the lazy restart backstop to distinguish a genuinely
   *  running job from an orphan left in `.airo/logo.json` after an agent restart
   *  (where the in-memory Maps are empty). */
  isInFlight(appId: string, jobId?: string): boolean {
    const primary: InFlightEntry | undefined = this.inFlight.get(appId)
    if (primary) return jobId ? primary.jobId === jobId : true
    if (!jobId) return false
    for (const entry of this.activeVariants.values()) {
      if (entry.jobId === jobId) return true
    }
    return false
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

    // Abort any in-progress follow-up variants for this app — they derive from
    // a stale parent and would produce outdated assets.
    for (const [key, entry] of this.activeVariants) {
      if (key.startsWith(`${appId}::`)) {
        entry.controller.abort('superseded')
        this.activeVariants.delete(key)
      }
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
        ...(params.references ? { references: params.references } : {}),
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
      await revertSlots(appId, { jobId, slots, previousSlots }).catch(() => { })
      return { status: 'error', error: 'Logo generation could not be started' }
    }

    const controller = new AbortController()
    this.inFlight.set(appId, { jobId, controller, slots, previousSlots, workspace })
    logger.info('logo.async.kickoff', {
      appId, jobId, layouts, slots, hasReferenceLogo: !!params.references?.logo, inspirationCount: params.references?.inspiration?.length ?? 0, isRegeneration,
    })

    // chainDeferred resolves when all chained follow-up variants settle (parallel).
    const chainDeferred: ChainDeferred | undefined = params.followUpVariants?.length
      ? (() => {
        let resolve!: (outcomes: LogoRunOutcome[]) => void
        const promise = new Promise<LogoRunOutcome[]>((r) => { resolve = r })
        return { promise, resolve }
      })()
      : undefined

    // Detach the run onto the next macrotask so start() returns with the job
    // observably in `queued` state before the worker flips it to `generating`
    // (the "kickoff returns immediately" contract). `done` resolves with this
    // job's terminal outcome — background callers ignore it; sync callers/tests await it.
    const done = new Promise<LogoRunOutcome>((resolve) => {
      setImmediate(() => {
        this.run({ ...params, jobId, slots, previousSlots, controller, workspace, chainDeferred })
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

    // Fallback: if the parent doesn't complete successfully, chainDeferred is
    // never resolved from run()'s followup block. Resolve with [] so it doesn't hang.
    if (chainDeferred) {
      done.then((outcome: LogoRunOutcome) => {
        if (outcome.status !== 'completed') chainDeferred.resolve([])
      })
    }

    return { status: 'queued', jobId, slots, done, chainDone: chainDeferred?.promise }
  }

  private variantDedupKey(appId: string, variant: LogoVariant, sourceUrl: string, prompt?: string): string {
    return `${appId}::${variant}::${sourceUrl}::${prompt?.trim() || ''}`
  }

  async startVariant(params: StartVariantParams): Promise<StartLogoResult> {
    const { appId, variant, sourceUrl } = params
    const workspace = createForWorkspace(appId, 'preview')?.files ?? null
    if (!workspace) {
      logger.error('logo.variant.no_workspace', { appId })
      return { status: 'error', error: 'Workspace unavailable for logo variant generation' }
    }

    // --- Dedup check: return existing active promise if compatible ---
    const dedupKey: string = this.variantDedupKey(appId, variant, sourceUrl, params.prompt)
    const exact: ActiveVariantEntry | undefined = this.activeVariants.get(dedupKey)
    if (exact) {
      logger.info('logo.variant.dedup_hit', { appId, variant, existingJobId: exact.jobId })
      return exact.result
    }

    // Slot supersession: different params for same appId+variant → abort old
    const slotPrefix: string = `${appId}::${variant}::`
    for (const [key, entry] of this.activeVariants) {
      if (key.startsWith(slotPrefix) && key !== dedupKey) {
        logger.info('logo.variant.slot_superseded', { appId, variant, oldJobId: entry.jobId })
        entry.controller.abort('superseded')
        this.activeVariants.delete(key)
      }
    }

    try {
      const onDisk = await readLogoJob(workspace, appId).catch(() => null)
      if (
        onDisk &&
        (onDisk.status === 'queued' || onDisk.status === 'generating') &&
        !this.isInFlight(appId, onDisk.jobId)
      ) {
        logger.info('logo.variant.restart_backstop', { appId, staleJobId: onDisk.jobId, status: onDisk.status })
        const { reconcileStaleLogoJob } = await import('./logo-reconciler.js')
        await reconcileStaleLogoJob(appId)
      }
    } catch (err) {
      logger.warn('logo.variant.restart_backstop_failed', {
        appId, error: err instanceof Error ? err.message : String(err),
      })
    }

    const slotPath: string = variant === 'favicon' ? FAVICON_SLOT_PATH : LOGO_SLOT_PATHS[variant as LogoLayout]
    const jobId: string = randomUUID()

    let previousSlots: Record<string, MediaSlot> = {}
    let isRegeneration = false
    try {
      const shimmerUrl: string = await ensureShimmerAsset(workspace, appId, 'square')
      const snapshot = await snapshotSlots(appId, [slotPath])
      previousSlots = snapshot.previousSlots
      isRegeneration = snapshot.isRegeneration
      await placeShimmerSlots(appId, [slotPath], jobId, { [slotPath]: shimmerUrl }, previousSlots)

      const now: string = new Date().toISOString()
      const job: LogoJob = {
        jobId,
        status: 'queued',
        prompt: params.prompt ?? '',
        layouts: [],
        slots: [slotPath],
        isRegeneration,
        previousSlots,
        attempt: 0,
        variant,
        createdAt: now,
        updatedAt: now,
      }
      await writeLogoJob(workspace, appId, job)
    } catch (err) {
      logger.error('logo.variant.setup_failed', {
        appId, jobId, error: err instanceof Error ? err.message : String(err),
      })
      await revertSlots(appId, { jobId, slots: [slotPath], previousSlots }).catch(() => { })
      return { status: 'error', error: 'Logo variant generation could not be started' }
    }

    const controller = new AbortController()
    logger.info('logo.variant.kickoff', { appId, jobId, variant, slotPath, isRegeneration })

    const done = new Promise<LogoRunOutcome>((resolve) => {
      setImmediate(() => {
        this.runVariant({ ...params, jobId, slotPath, previousSlots, controller, workspace })
          .then(resolve)
          .catch(async (err) => {
            logger.error('logo.variant.worker.unhandled', {
              appId, jobId, error: err instanceof Error ? err.message : String(err),
            })
            resolve(await this.fail(appId, jobId, workspace, 0, err, {
              suppressGrowl: params.suppressGrowl,
              revertContext: { slots: [slotPath], previousSlots },
            }))
          })
      })
    })

    const startResult: StartLogoResult = { status: 'queued', jobId, slots: [slotPath], done }
    this.activeVariants.set(dedupKey, { jobId, controller, done, result: startResult })
    done.finally(() => {
      if (this.activeVariants.get(dedupKey)?.jobId === jobId) {
        this.activeVariants.delete(dedupKey)
      }
    })

    return startResult
  }

  private async runVariant(ctx: VariantRunContext): Promise<LogoRunOutcome> {
    const { appId, jobId, slotPath, controller, workspace } = ctx

    if (controller.signal.aborted) {
      logger.info('logo.variant.worker.aborted', { appId, jobId })
      return { status: 'cancelled', jobId }
    }

    // Abort signal (from activeVariants dedup map) is the sole supersession
    // authority for variants. Mid-run job-file reads are skipped because parallel
    // variants share one .airo/logo.json — reads would race. A terminal write
    // happens at the end so the backstop doesn't reconcile the stale 'queued' entry.
    logger.info('logo.variant.worker.begin', { appId, jobId, variant: ctx.variant })

    let response: LogoSessionResponse | undefined
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (controller.signal.aborted) {
        logger.info('logo.variant.worker.aborted', { appId, jobId })
        return { status: 'cancelled', jobId }
      }
      try {
        response = await logoService.generateVariantV3({
          sourceUrl: ctx.sourceUrl,
          variant: ctx.variant,
          ...(ctx.prompt ? { prompt: ctx.prompt } : {}),
          ...(ctx.colors ? { colors: ctx.colors } : {}),
          ...(ctx.brandName ? { brandName: ctx.brandName } : {}),
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
          logger.info('logo.variant.worker.aborted', { appId, jobId })
          return { status: 'cancelled', jobId }
        }
        if (this.isHardError(err) || attempt >= MAX_ATTEMPTS) {
          return this.fail(appId, jobId, workspace, attempt, err, {
            suppressGrowl: ctx.suppressGrowl,
            revertContext: { slots: [slotPath], previousSlots: ctx.previousSlots },
          })
        }
        const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? 3000
        logger.warn('logo.variant.worker.retry', {
          appId, jobId, attempt, delayMs, reason: err instanceof Error ? err.message : String(err),
        })
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
    if (!response) return { status: 'failed', jobId }

    if (controller.signal.aborted) {
      logger.warn('logo.variant.worker.aborted_post_generate', { appId, jobId })
      return { status: 'cancelled', jobId }
    }

    const transparentUrl = response.logo.urls.square?.transparent
    if (!transparentUrl) {
      return this.fail(appId, jobId, workspace, MAX_ATTEMPTS, new Error('Variant response missing transparent URL'), {
        suppressGrowl: ctx.suppressGrowl,
        revertContext: { slots: [slotPath], previousSlots: ctx.previousSlots },
      })
    }

    const groupId: string = await this.resolveOrCreateGroupId(appId, ctx.sourceUrl, jobId)

    const saved = await saveSingleLogoSlot(
      appId, slotPath, transparentUrl,
      response.sessionId, response.logo.id, jobId,
      ctx.prompt?.slice(0, 80) ?? ctx.variant,
      groupId,
    )

    logger.info('logo.variant.worker.slot_saved', { appId, jobId, slotPath, saved })

    if (controller.signal.aborted) {
      logger.warn('logo.variant.worker.cancelled_during_save', { appId, jobId })
      await revertSlots(appId, { jobId, slots: [slotPath], previousSlots: ctx.previousSlots }).catch(() => { })
      return { status: 'cancelled', jobId }
    }

    // Write terminal state so the backstop doesn't see stale 'queued' and revert
    // the just-saved slot. Guard: only write if the file still has OUR jobId — if a
    // new primary (or another variant's setup) already overwrote it, they own the
    // file now and our write would clobber their 'queued', causing their run() to
    // bail incorrectly as 'superseded'.
    const currentJob: LogoJob | null = await readLogoJob(workspace, appId).catch(() => null)
    if (currentJob && currentJob.jobId === jobId) {
      await writeLogoJob(workspace, appId, {
        ...currentJob,
        status: 'completed',
        sessionId: response.sessionId,
        logoId: response.logo.id,
        updatedAt: new Date().toISOString(),
      }).catch((err: unknown) => {
        logger.warn('logo.variant.terminal_write_failed', {
          appId, jobId, error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    this.emitLogoEvent(appId, {
      status: 'completed',
      jobId,
      slots: [slotPath],
      slotSaveFailed: !saved,
      failedLayouts: [],
      skippedLayouts: [],
      logoId: response.logo.id,
      logo: response.logo,
      ...(ctx.suppressGrowl ? { suppressGrowl: true } : {}),
    })
    logger.info('logo.variant.worker.complete', {
      appId, jobId, sessionId: response.sessionId, logoId: response.logo.id,
    })
    return {
      status: 'completed', jobId, logoId: response.logo.id, logo: response.logo,
      sessionId: response.sessionId, slotSaveFailed: !saved, failedLayouts: [], skippedLayouts: [],
    }
  }

  private async resolveOrCreateGroupId(appId: string, sourceUrl: string, fallbackId: string): Promise<string> {
    for (const path of ALL_LOGO_SLOT_PATHS) {
      try {
        const result = await mediaManifestService.getSlot(appId, path)
        if (result.success && result.slot?.currentUrl === sourceUrl) {
          if (result.slot.logoGroupId) return result.slot.logoGroupId
          // Source has no group — create one and back-annotate
          const groupId: string = randomUUID()
          const updatedSourceMap: Record<string, { sessionId?: string; logoId?: string; groupId?: string }> = {
            ...(result.slot.logoSourceMap ?? {}),
            [sourceUrl]: { ...(result.slot.logoSourceMap?.[sourceUrl] ?? {}), groupId },
          }
          await mediaManifestService.setSlot(appId, path, {
            ...result.slot,
            logoGroupId: groupId,
            logoSourceMap: updatedSourceMap,
            lastUpdated: new Date().toISOString(),
          })
          logger.info('logo.variant.group_back_annotated', { appId, slotPath: path, groupId })
          return groupId
        }
      } catch (err) {
        logger.warn('logo.variant.group_lookup_failed', { appId, slotPath: path, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return fallbackId
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
      await revertSlots(appId, entry).catch(() => { })
    }
    // Persist the terminal status when the job file is still readable + ours.
    const job = await readLogoJob(entry.workspace, appId).catch(() => null)
    if (job && job.jobId === entry.jobId) {
      await writeLogoJob(entry.workspace, appId, {
        ...job, status: 'cancelled', updatedAt: new Date().toISOString(),
      }).catch(() => { })
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
        return { status: 'cancelled', jobId }
      }
      try {
        const isEdit = Boolean(ctx.references?.logo)
        const perLayoutResults: LogoSessionResponse[] = await Promise.all(
          ctx.layouts.map((layout) => {
            const commonLogoServiceParams = {
              prompt: ctx.prompt,
              layout,
              ...(ctx.references?.inspiration?.length ? { inspiration: ctx.references.inspiration } : {}),
              ...(ctx.colors ? { colors: ctx.colors } : {}),
              ...(ctx.brandName ? { brandName: ctx.brandName } : {}),
              appId,
              customerId: ctx.customerId,
              budgetUserId: ctx.budgetUserId,
              ...(ctx.traceparent ? { traceparent: ctx.traceparent } : {}),
              ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
              signal: controller.signal,
            };
            if (isEdit) {
              return logoService.editV3({ sourceUrl: ctx.references!.logo!, ...commonLogoServiceParams });
            }
            return logoService.generateV3(commonLogoServiceParams);
          }),
        )
        const mergedUrls: LogoSessionResponse['logo']['urls'] = {}
        for (const r of perLayoutResults) {
          Object.assign(mergedUrls, r.logo.urls)
        }
        const first: LogoSessionResponse = perLayoutResults[0]!
        response = {
          sessionId: first.sessionId,
          logo: { ...first.logo, urls: mergedUrls },
        }
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
    if (!response) return { status: 'failed', jobId }

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
      await revertSlots(appId, { jobId, slots, previousSlots: ctx.previousSlots }).catch(() => { })
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

    if (ctx.followUpVariants?.length && !slotSaveFailed) {
      this.fireFollowUpVariants(appId, ctx, savedSlots)
        .then((outcomes: LogoRunOutcome[]) => ctx.chainDeferred?.resolve(outcomes))
        .catch((err) => {
          logger.warn('logo.worker.followup_chain_failed', {
            appId, jobId, error: err instanceof Error ? err.message : String(err),
          })
          ctx.chainDeferred?.resolve([])
        })
    } else {
      ctx.chainDeferred?.resolve([])
    }

    return { status: 'completed', jobId, logoId: response.logo.id, logo: response.logo, sessionId: response.sessionId, slotSaveFailed, failedLayouts, skippedLayouts }
  }

  private async fireFollowUpVariants(
    appId: string,
    ctx: RunContext,
    savedSlots: Partial<Record<LogoLayout, string>>,
  ): Promise<LogoRunOutcome[]> {
    // Bail if a new primary started (old followups are stale)
    if (this.inFlight.has(appId)) return []

    // Resolve source URL from just-saved slots (same priority as generate_logo_variant tool).
    const candidateOrder: LogoLayout[] = ['square', 'horizontal', 'vertical']
    let sourceUrl: string | undefined
    for (const layout of candidateOrder) {
      if (!savedSlots[layout]) continue
      const slotPath: string = LOGO_SLOT_PATHS[layout]
      const r = await mediaManifestService.getSlot(appId, slotPath)
      if (r.success && r.slot?.currentUrl && r.slot.logoSourceMap?.[r.slot.currentUrl]) {
        sourceUrl = r.slot.currentUrl
        break
      }
    }
    if (!sourceUrl) {
      logger.warn('logo.worker.followup_no_source', { appId, jobId: ctx.jobId })
      return []
    }

    logger.info('logo.worker.followup_fire', { appId, parentJobId: ctx.jobId, variants: ctx.followUpVariants })

    const results: StartLogoResult[] = await Promise.all(
      ctx.followUpVariants!.map((variant: LogoVariant) =>
        this.startVariant({
          appId,
          sourceUrl: sourceUrl!,
          variant,
          customerId: ctx.customerId,
          budgetUserId: ctx.budgetUserId,
          suppressGrowl: true,
          ...(ctx.brandName ? { brandName: ctx.brandName } : {}),
          ...(ctx.colors ? { colors: ctx.colors } : {}),
          ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
        }).catch((err: unknown): StartLogoResult => {
          logger.warn('logo.worker.followup_variant_failed', {
            appId, parentJobId: ctx.jobId, variant,
            error: err instanceof Error ? err.message : String(err),
          })
          return { status: 'error', error: err instanceof Error ? err.message : String(err) }
        }),
      ),
    )

    const started: StartLogoResult[] = results.filter((r: StartLogoResult): boolean => !!r.done)
    const settled: PromiseSettledResult<LogoRunOutcome>[] = await Promise.allSettled(
      started.map((r: StartLogoResult) => r.done!),
    )
    return settled.map((s: PromiseSettledResult<LogoRunOutcome>, i: number): LogoRunOutcome =>
      s.status === 'fulfilled'
        ? s.value
        : { status: 'failed', jobId: started[i]?.jobId ?? '', error: s.reason instanceof Error ? s.reason.message : String(s.reason) },
    )
  }

  private async fail(
    appId: string, jobId: string, workspace: WorkspaceFiles, attempt: number, err: unknown,
    opts?: { suppressGrowl?: boolean; revertContext?: RevertContext },
  ): Promise<LogoRunOutcome> {
    const errorKind: string = BudgetExceededError.isInstance(err) ? 'budget' : 'error'
    const message: string = err instanceof Error ? err.message : String(err)
    logger.error('logo.worker.failed', { appId, jobId, attempt, errorKind, error: message })

    // Best-effort read; a supervisor read outage must not stop us clearing the shimmer.
    const job: LogoJob | null = await readLogoJob(workspace, appId).catch(() => null)
    const entry: InFlightEntry | undefined = this.inFlight.get(appId)
    const silentFlag = opts?.suppressGrowl ? { suppressGrowl: true } : {}
    if (job && job.jobId === jobId) {
      await revertSlots(appId, job).catch(() => { })
      await writeLogoJob(workspace, appId, { ...job, status: 'failed', error: message, updatedAt: new Date().toISOString() }).catch(() => { })
      this.emitLogoEvent(appId, { status: 'failed', jobId, slots: job.slots, error: message, errorKind, ...silentFlag })
    } else if (entry && entry.jobId === jobId) {
      await revertSlots(appId, entry).catch(() => { })
      this.emitLogoEvent(appId, { status: 'failed', jobId, slots: entry.slots, error: message, errorKind, ...silentFlag })
    } else if (opts?.revertContext) {
      await revertSlots(appId, { jobId, slots: opts.revertContext.slots, previousSlots: opts.revertContext.previousSlots }).catch(() => { })
      this.emitLogoEvent(appId, { status: 'failed', jobId, slots: opts.revertContext.slots, error: message, errorKind, ...silentFlag })
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
