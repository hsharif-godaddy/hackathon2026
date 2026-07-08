import chroma from 'chroma-js'

import { logger } from '../../logging/index.js'
import { mediaManifestService, type MediaSlot } from '../MediaManifestService.js'
import type { LogoLayout, LayoutUrls, LogoSessionResponse, LogoColors } from '../LogoService.js'
import { isShimmerUrl, LOGO_SHIMMER_SLOT_URLS } from './logo-shimmer.js'
import type { LogoJob } from './logo-job-state.js'

export const LOGO_SLOT_PATHS: Record<LogoLayout, string> = {
  square: 'logo/primary',
  horizontal: 'logo/horizontal',
  vertical: 'logo/vertical',
}

export const FAVICON_SLOT_PATH = 'logo/favicon'

export const ALL_LAYOUTS: LogoLayout[] = ['square', 'horizontal', 'vertical']

export const ALL_LOGO_SLOT_PATHS: string[] = [...Object.values(LOGO_SLOT_PATHS), FAVICON_SLOT_PATH]

export type SurfaceMode = 'light' | 'dark'

/**
 * Classify a hex color as light or dark based on perceptual luminance.
 * Uses chroma-js (same library as gai-logo-agent) for robust parsing.
 */
export function classifySurface(hex: string): SurfaceMode {
  try {
    return chroma(hex).luminance() >= 0.5 ? 'light' : 'dark'
  } catch (err) {
    logger.warn('logo.classifySurface.parse_failed', {
      hex,
      error: err instanceof Error ? err.message : String(err),
    })
    return 'light'
  }
}

interface SurfaceSlotFields {
  surfaceMode?: SurfaceMode
  generatedForSurfaceColor?: string
  lightSurfaceUrl?: string
  darkSurfaceUrl?: string
}

function buildSurfaceFields(colors: LogoColors | undefined, url: string): SurfaceSlotFields {
  const surfaceBg: string | undefined = colors?.background
  if (!surfaceBg) return {}
  const mode: SurfaceMode = classifySurface(surfaceBg)
  const variantKey: 'lightSurfaceUrl' | 'darkSurfaceUrl' =
    mode === 'light' ? 'lightSurfaceUrl' : 'darkSurfaceUrl'
  return { surfaceMode: mode, generatedForSurfaceColor: surfaceBg, [variantKey]: url }
}

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
  colors?: LogoColors,
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

    const solidUrlMap: Record<string, string> = variants.solid ? { [transparent]: variants.solid } : {}
    const mockupUrlMap: Record<string, string> = variants.mockup ? { [transparent]: variants.mockup } : {}
    const landscapeMockupUrlMap: Record<string, string> = variants.landscapeMockup ? { [transparent]: variants.landscapeMockup } : {}
    const logoSourceMap = {
      [transparent]: { sessionId: response.sessionId, logoId: response.logo.id },
    }

    let mergedAlternatives: string[] = []
    let mergedSolidUrlMap = { ...solidUrlMap }
    let mergedMockupUrlMap = { ...mockupUrlMap }
    let mergedLandscapeMockupUrlMap = { ...landscapeMockupUrlMap }
    let mergedLogoSourceMap: Record<string, { sessionId?: string; logoId?: string; groupId?: string }> = { ...logoSourceMap }
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
      let existingSurface: SurfaceSlotFields = {}

      if (existing.success && existing.slot) {
        const old = existing.slot
        const oldUrls = [old.currentUrl, ...(old.alternatives ?? [])].filter(
          (u) => u && u !== transparent && !isShimmerUrl(u),
        )
        mergedAlternatives = oldUrls
        mergedSolidUrlMap = { ...(old.solidUrlMap ?? {}), ...solidUrlMap }
        mergedMockupUrlMap = { ...(old.mockupUrlMap ?? {}), ...mockupUrlMap }
        mergedLandscapeMockupUrlMap = {
          ...(old.landscapeMockupUrlMap ?? {}),
          ...landscapeMockupUrlMap,
        }
        mergedLogoSourceMap = { ...(old.logoSourceMap ?? {}), ...logoSourceMap }
        createdAt = old.createdAt || now
        existingSurface = {
          ...(old.surfaceMode ? { surfaceMode: old.surfaceMode as SurfaceMode } : {}),
          ...(old.generatedForSurfaceColor ? { generatedForSurfaceColor: old.generatedForSurfaceColor } : {}),
          ...(old.lightSurfaceUrl ? { lightSurfaceUrl: old.lightSurfaceUrl } : {}),
          ...(old.darkSurfaceUrl ? { darkSurfaceUrl: old.darkSurfaceUrl } : {}),
        }
      }

      const surface: SurfaceSlotFields = buildSurfaceFields(colors, transparent)

      await mediaManifestService.setSlot(appId, slotPath, {
        mediaType: 'logo',
        currentUrl: transparent,
        searchQuery,
        alternatives: mergedAlternatives,
        solidUrlMap: mergedSolidUrlMap,
        mockupUrlMap: mergedMockupUrlMap,
        landscapeMockupUrlMap: mergedLandscapeMockupUrlMap,
        logoSourceMap: mergedLogoSourceMap,
        userModified: false,
        createdAt,
        lastUpdated: now,
        ...existingSurface,
        ...surface,
      })

      savedSlots[layout] = `/airo-assets/images/${slotPath}`
      logger.info('skill.media-logo.slot_saved', {
        appId, slotPath, layout, sessionId: response.sessionId, surfaceMode: surface.surfaceMode,
      })
    } catch (err) {
      failedLayouts.push(layout)
      logger.error('skill.media-logo.slot_save_failed', {
        appId, slotPath, layout,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Cascade: a new generate_logo has no groupId, so any sibling slot still
  // carrying a logoGroupId belongs to an old set and is now stale.
  const writtenSlotPaths: Set<string> = new Set(
    Object.keys(savedSlots).map((l) => LOGO_SLOT_PATHS[l as LogoLayout]),
  )
  const allLogoSlotPaths: string[] = [...Object.values(LOGO_SLOT_PATHS), FAVICON_SLOT_PATH]
  for (const siblingPath of allLogoSlotPaths) {
    if (writtenSlotPaths.has(siblingPath)) continue
    try {
      const siblingResult = await mediaManifestService.getSlot(appId, siblingPath)
      if (
        siblingResult.success &&
        siblingResult.slot?.logoGroupId &&
        siblingResult.slot.logoSourceMap
      ) {
        await mediaManifestService.setSlot(appId, siblingPath, {
          ...siblingResult.slot,
          logoGroupId: undefined,
          lastUpdated: now,
        })
        logger.info('skill.media-logo.cascade_clear_group', { appId, siblingPath })
      }
    } catch (err) {
      logger.warn('skill.media-logo.cascade_clear_group_failed', { appId, siblingPath, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { savedSlots, slotSaveFailed: failedLayouts.length > 0, failedLayouts, skippedLayouts }
}
// --- END moved block ---

/** Save a single logo URL to an arbitrary slot path. Used by variant jobs
 *  (favicon, layout re-derive) where only one slot is affected. Respects the
 *  userModified guard: skips slots the user manually overrode unless THIS job
 *  owns the pending marker. Returns true when saved, false when skipped. */
export async function saveSingleLogoSlot(
  appId: string,
  slotPath: string,
  transparentUrl: string,
  sessionId: string,
  logoId: string,
  ownerJobId: string,
  searchQuery: string,
  groupId?: string,
  colors?: LogoColors,
): Promise<boolean> {
  const now = new Date().toISOString()

  let createdAt = now
  let mergedAlternatives: string[] = []
  let mergedLogoSourceMap: Record<string, { sessionId?: string; logoId?: string; groupId?: string }> = {}

  try {
    const existing = await mediaManifestService.getSlot(appId, slotPath)
    if (
      existing.success &&
      existing.slot?.userModified === true &&
      existing.slot.pendingJobId !== ownerJobId
    ) {
      logger.info('skill.media-logo.variant_slot_skipped_user_modified', {
        appId,
        slotPath,
        ownerJobId,
      })
      return false
    }
    let existingSurface: SurfaceSlotFields = {}

    if (existing.success && existing.slot) {
      const old = existing.slot
      const oldUrls = [old.currentUrl, ...(old.alternatives ?? [])].filter(
        (u) => u && u !== transparentUrl,
      )
      mergedAlternatives = oldUrls
      mergedLogoSourceMap = { ...(old.logoSourceMap ?? {}) }
      createdAt = old.createdAt || now
      existingSurface = {
        ...(old.surfaceMode ? { surfaceMode: old.surfaceMode as SurfaceMode } : {}),
        ...(old.generatedForSurfaceColor ? { generatedForSurfaceColor: old.generatedForSurfaceColor } : {}),
        ...(old.lightSurfaceUrl ? { lightSurfaceUrl: old.lightSurfaceUrl } : {}),
        ...(old.darkSurfaceUrl ? { darkSurfaceUrl: old.darkSurfaceUrl } : {}),
      }
    }

    mergedLogoSourceMap[transparentUrl] = { sessionId, logoId, ...(groupId ? { groupId } : {}) }

    const surface: SurfaceSlotFields = buildSurfaceFields(colors, transparentUrl)

    await mediaManifestService.setSlot(appId, slotPath, {
      mediaType: 'logo',
      currentUrl: transparentUrl,
      searchQuery,
      alternatives: mergedAlternatives,
      logoSourceMap: mergedLogoSourceMap,
      ...(groupId ? { logoGroupId: groupId } : {}),
      userModified: false,
      createdAt,
      lastUpdated: now,
      ...existingSurface,
      ...surface,
    })
    logger.info('skill.media-logo.variant_slot_saved', { appId, slotPath, sessionId, surfaceMode: surface.surfaceMode })
    return true
  } catch (err) {
    logger.error('skill.media-logo.variant_slot_save_failed', {
      appId,
      slotPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

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
 *  Always writes the shimmer SVG as currentUrl so the BrandBook sidebar never
 *  flashes the old logo during regeneration. The old state is preserved in
 *  `previousSlots` for revert on cancel/failure. Variant maps are carried forward
 *  so saveLogoToSlots can still merge them. */
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
    await mediaManifestService.setSlot(appId, slotPath, {
      mediaType: 'logo',
      currentUrl: shimmerUrlBySlot[slotPath] ?? LOGO_SHIMMER_SLOT_URLS.square,
      searchQuery: prior?.searchQuery ?? '',
      alternatives: prior?.alternatives ?? [],
      ...(prior?.solidUrlMap ? { solidUrlMap: prior.solidUrlMap } : {}),
      ...(prior?.mockupUrlMap ? { mockupUrlMap: prior.mockupUrlMap } : {}),
      ...(prior?.landscapeMockupUrlMap ? { landscapeMockupUrlMap: prior.landscapeMockupUrlMap } : {}),
      ...(prior?.logoSourceMap ? { logoSourceMap: prior.logoSourceMap } : {}),
      ...(prior?.logoGroupId ? { logoGroupId: prior.logoGroupId } : {}),
      ...(prior?.currentUrl?.startsWith('http') ? { priorUrl: prior.currentUrl } : {}),
      userModified: false,
      pendingJobId: jobId,
      createdAt: prior?.createdAt ?? now,
      lastUpdated: now,
    })
    logger.info('logo.slots.precreate', { appId, jobId, slot: slotPath, regeneration: !!prior })
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
