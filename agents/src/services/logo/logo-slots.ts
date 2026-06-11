import { logger } from '../../logging/index.js'
import { mediaManifestService, type MediaSlot } from '../MediaManifestService.js'
import type { LogoLayout, LayoutUrls, LogoSessionResponse } from '../LogoService.js'
import { isShimmerUrl, LOGO_SHIMMER_SLOT_URLS } from './logo-shimmer.js'
import type { LogoJob } from './logo-job-state.js'

export const LOGO_SLOT_PATHS: Record<LogoLayout, string> = {
  square: 'logo/primary',
  horizontal: 'logo/horizontal',
  vertical: 'logo/vertical',
}

export const ALL_LAYOUTS: LogoLayout[] = ['square', 'horizontal', 'vertical']

export interface SaveSlotsResult {
  savedSlots: Partial<Record<LogoLayout, string>>
  slotSaveFailed: boolean
  failedLayouts: LogoLayout[]
  /** Layouts left untouched because the user had manually overridden that slot
   *  (userModified) and this job does not own the slot's pending marker. These are
   *  a success-of-sorts ("kept your custom logo"), NOT failures, so the caller can
   *  surface them distinctly without treating them as a save error. */
  skippedLayouts: LogoLayout[]
}

// --- MOVED VERBATIM from skills/media-logo/tools/index.ts (do not alter logic) ---
export async function saveLogoToSlots(
  appId: string,
  response: LogoSessionResponse,
  searchQuery: string,
  ownerJobId: string,
): Promise<SaveSlotsResult> {
  const savedSlots: Partial<Record<LogoLayout, string>> = {}
  const failedLayouts: LogoLayout[] = []
  const skippedLayouts: LogoLayout[] = []
  const now = new Date().toISOString()

  for (const layout of ALL_LAYOUTS) {
    const variants: LayoutUrls | undefined = response.logo.urls[layout]
    if (!variants) continue

    const slotPath = LOGO_SLOT_PATHS[layout]
    const transparent = variants.transparent

    const solidUrlMap = { [transparent]: variants.solid }
    const reversedUrlMap = { [transparent]: variants.reversed }
    const reversedSolidUrlMap = { [transparent]: variants.reversedSolid }
    const mockupUrlMap = { [transparent]: variants.mockup }
    const landscapeMockupUrlMap = { [transparent]: variants.landscapeMockup }
    const logoSourceMap = {
      [transparent]: { sessionId: response.sessionId, logoId: response.logo.id },
    }

    let mergedAlternatives: string[] = []
    let mergedSolidUrlMap = { ...solidUrlMap }
    let mergedReversedUrlMap = { ...reversedUrlMap }
    let mergedReversedSolidUrlMap = { ...reversedSolidUrlMap }
    let mergedMockupUrlMap = { ...mockupUrlMap }
    let mergedLandscapeMockupUrlMap = { ...landscapeMockupUrlMap }
    let mergedLogoSourceMap = { ...logoSourceMap }
    let createdAt = now

    try {
      const existing = await mediaManifestService.getSlot(appId, slotPath)
      // Save-time guard: never clobber a slot the user manually overrode unless
      // THIS job owns its pending marker (our own shimmer/regeneration legitimately
      // owns the slot — placeShimmerSlots set pendingJobId === ownerJobId, and the
      // regeneration path preserves userModified). A fresh slot (getSlot fails) or
      // a slot we own falls through to the write.
      if (
        existing.success &&
        existing.slot?.userModified === true &&
        existing.slot.pendingJobId !== ownerJobId
      ) {
        skippedLayouts.push(layout)
        logger.info('skill.media-logo.slot_skipped_user_modified', {
          appId, slotPath, layout, ownerJobId,
        })
        continue
      }
      if (existing.success && existing.slot) {
        const old = existing.slot
        const oldUrls = [old.currentUrl, ...(old.alternatives ?? [])].filter(
          (u) => u && u !== transparent,
        )
        mergedAlternatives = oldUrls
        mergedSolidUrlMap = { ...(old.solidUrlMap ?? {}), ...solidUrlMap }
        mergedReversedUrlMap = { ...(old.reversedUrlMap ?? {}), ...reversedUrlMap }
        mergedReversedSolidUrlMap = { ...(old.reversedSolidUrlMap ?? {}), ...reversedSolidUrlMap }
        mergedMockupUrlMap = { ...(old.mockupUrlMap ?? {}), ...mockupUrlMap }
        mergedLandscapeMockupUrlMap = {
          ...(old.landscapeMockupUrlMap ?? {}),
          ...landscapeMockupUrlMap,
        }
        mergedLogoSourceMap = { ...(old.logoSourceMap ?? {}), ...logoSourceMap }
        createdAt = old.createdAt || now
      }

      await mediaManifestService.setSlot(appId, slotPath, {
        mediaType: 'logo',
        currentUrl: transparent,
        searchQuery,
        alternatives: mergedAlternatives,
        solidUrlMap: mergedSolidUrlMap,
        reversedUrlMap: mergedReversedUrlMap,
        reversedSolidUrlMap: mergedReversedSolidUrlMap,
        mockupUrlMap: mergedMockupUrlMap,
        landscapeMockupUrlMap: mergedLandscapeMockupUrlMap,
        logoSourceMap: mergedLogoSourceMap,
        userModified: false,
        createdAt,
        lastUpdated: now,
      })

      savedSlots[layout] = `/airo-assets/images/${slotPath}`
      logger.info('skill.media-logo.slot_saved', {
        appId, slotPath, layout, sessionId: response.sessionId,
      })
    } catch (err) {
      failedLayouts.push(layout)
      logger.error('skill.media-logo.slot_save_failed', {
        appId, slotPath, layout,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { savedSlots, slotSaveFailed: failedLayouts.length > 0, failedLayouts, skippedLayouts }
}
// --- END moved block ---

/** Snapshot the current real logos for the given slots (so cancel/failure can
 *  restore them). A shimmer placeholder or missing slot is NOT snapshotted.
 *
 *  A slot with `pendingJobId` set IS snapshotted as long as its currentUrl is a
 *  real (non-shimmer) logo: that's the regeneration case where an older job kept
 *  the prior hosted logo under its placeholder. Skipping it (the old behaviour)
 *  meant superseding an in-flight regeneration lost the prior logo, so a later
 *  failure/cancel of the new job would delete the user's existing logo. The
 *  stale `pendingJobId` is stripped from the stored snapshot so a revert restores
 *  a clean, non-pending slot. */
export async function snapshotSlots(
  appId: string,
  slotPaths: string[],
): Promise<{ previousSlots: Record<string, MediaSlot>; isRegeneration: boolean }> {
  const previousSlots: Record<string, MediaSlot> = {}
  for (const slotPath of slotPaths) {
    const result = await mediaManifestService.getSlot(appId, slotPath)
    const slot = result.success ? result.slot : undefined
    if (slot && slot.currentUrl && !isShimmerUrl(slot.currentUrl)) {
      const { pendingJobId: _pendingJobId, ...clean } = slot
      previousSlots[slotPath] = clean
      logger.debug('logo.slots.snapshot', { appId, slot: slotPath, hadPendingJob: !!slot.pendingJobId })
    }
  }
  return { previousSlots, isRegeneration: Object.keys(previousSlots).length > 0 }
}

/** Tag each requested slot with the owning jobId so app-UI can show progress.
 *  Regeneration (a real prior logo exists in `previousSlots`) KEEPS the prior
 *  hosted currentUrl + all variant maps, so the UI can show the existing logo
 *  under an "updating" shimmer overlay. A fresh slot points at the shimmer asset
 *  so the UI shows a bare animated shimmer. */
export async function placeShimmerSlots(
  appId: string,
  slotPaths: string[],
  jobId: string,
  shimmerUrlBySlot: Record<string, string>,
  previousSlots: Record<string, MediaSlot>,
): Promise<void> {
  const now = new Date().toISOString()
  for (const slotPath of slotPaths) {
    const prior = previousSlots[slotPath]
    if (prior) {
      await mediaManifestService.setSlot(appId, slotPath, {
        ...prior,
        pendingJobId: jobId,
        lastUpdated: now,
      })
      logger.info('logo.slots.precreate', { appId, jobId, slot: slotPath, regeneration: true })
    } else {
      await mediaManifestService.setSlot(appId, slotPath, {
        mediaType: 'logo',
        currentUrl: shimmerUrlBySlot[slotPath] ?? LOGO_SHIMMER_SLOT_URLS.square,
        searchQuery: '',
        alternatives: [],
        userModified: false,
        pendingJobId: jobId,
        createdAt: now,
        lastUpdated: now,
      })
      logger.info('logo.slots.precreate', { appId, jobId, slot: slotPath, regeneration: false })
    }
  }
}

/** Revert this job's slots: restore the prior logo (regeneration) or remove the
 *  fresh placeholder. Skips slots a newer job has taken over (supersede-safe).
 *  Accepts either a full LogoJob or the in-memory in-flight entry (both carry the
 *  jobId/slots/previousSlots needed), so error paths can revert without a job-file read. */
export async function revertSlots(
  appId: string,
  job: Pick<LogoJob, 'jobId' | 'slots' | 'previousSlots'>,
): Promise<void> {
  for (const slotPath of job.slots) {
    const current = await mediaManifestService.getSlot(appId, slotPath)
    if (current.success && current.slot?.pendingJobId && current.slot.pendingJobId !== job.jobId) {
      logger.info('logo.revert.skip_superseded', {
        appId, jobId: job.jobId, slot: slotPath, ownerJobId: current.slot.pendingJobId,
      })
      continue
    }
    const prior = job.previousSlots[slotPath]
    if (prior) {
      await mediaManifestService.setSlot(appId, slotPath, prior)
      logger.info('logo.revert.restore', { appId, jobId: job.jobId, slot: slotPath })
    } else {
      await mediaManifestService.removeSlot(appId, slotPath)
      logger.info('logo.revert.remove_placeholder', { appId, jobId: job.jobId, slot: slotPath })
    }
  }
}
