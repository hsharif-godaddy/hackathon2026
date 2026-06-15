import type { BrandDataMoodImage } from '@airo/shared/brand-data'
import { mediaManifestService } from '../MediaManifestService.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'brand-mood-images' })

/**
 * Resolve the brand-mood image set from the media manifest (`brand/mood-*`
 * slots), sorted numerically by slot. The `media` tool writes these slots, so
 * this is the deterministic source of truth the wizard UI + showcase read — never
 * dependent on the agent remembering to record them in memory. Non-fatal: returns
 * [] on any failure. Shared by the `brand` tool (`get` mode) and the brand-data
 * route so the two never drift.
 */
export async function getBrandMoodImages(appId: string): Promise<BrandDataMoodImage[]> {
  try {
    const result = await mediaManifestService.getManifest(appId)
    if (!result.success || !result.manifest) return []
    return Object.entries(result.manifest)
      .filter(([slot, entry]) => slot.startsWith('brand/mood-') && !!entry.currentUrl)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([slot, entry]) => ({ slot, url: entry.currentUrl }))
  } catch (error) {
    logger.warn('brandMoodImages.parse_failed', { appId, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}
