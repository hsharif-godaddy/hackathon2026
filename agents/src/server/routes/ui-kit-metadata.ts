import type JSZip from 'jszip'
import { AppMetadataRepository } from '../../database/repositories/AppMetadataRepository.js'
import { logger } from '../../logging/index.js'
import type { DesignKitRef } from '../../types/design-kit.js'

/**
 * Locate a kit's `kit-meta.json` in an uploaded zip — at the root, or one level
 * under a single wrapping folder (`commonPrefix`, e.g. macOS Finder wrapping).
 * Shared so UI-kit *detection* (ui-kit.ts) and id *resolution* (here) read the
 * same location and can't drift.
 */
export function findKitMetaFile(zip: JSZip, commonPrefix: string): JSZip.JSZipObject | undefined {
  return zip.files['kit-meta.json'] ?? zip.files[`${commonPrefix}kit-meta.json`]
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

// Derived from the union so it can't desync from the upload variant.
type UploadedKitRef = Omit<Extract<DesignKitRef, { source: 'upload' }>, 'source'>

/**
 * Resolve a design-kit reference from an uploaded UI kit's `kit-meta.json`.
 *
 * `displayName` is the human-readable label: prefer a top-level `displayName`,
 * then the uploaded-kit `metadata.name`, then the deprecated `slug`, else the
 * uploaded file's name (sans `.zip`). A catalog-derived kit's meta may also
 * carry the stable `id`/`kitId` UUIDs — captured independently of the
 * displayName resolution, so they survive even when the label falls back to the
 * filename (e.g. a kit-meta with UUIDs but no name fields).
 */
async function resolveUploadedKitRef(
  appId: string,
  zip: JSZip,
  commonPrefix: string,
  fileName: string
): Promise<UploadedKitRef> {
  const fallbackName = fileName.replace(/\.zip$/i, '')
  const metaFile = findKitMetaFile(zip, commonPrefix)
  if (!metaFile) return { displayName: fallbackName }

  try {
    const meta = JSON.parse(await metaFile.async('string')) as {
      displayName?: unknown
      slug?: unknown
      id?: unknown
      kitId?: unknown
      metadata?: { name?: unknown }
    }
    const id = firstNonEmptyString(meta.id)
    const kitId = firstNonEmptyString(meta.kitId)
    const displayName = firstNonEmptyString(meta.displayName, meta.metadata?.name, meta.slug) ?? fallbackName
    return { displayName, ...(id ? { id } : {}), ...(kitId ? { kitId } : {}) }
  } catch (err) {
    // kit-meta.json is present but unreadable (corrupt zip entry or malformed
    // JSON) — fall back to the filename, but leave a trace so a kit that *had*
    // a real id but failed to decode is debuggable rather than silent.
    logger.warn('route.file-upload.kit_meta_unreadable', { appId, fileName, err: String(err) })
    return { displayName: fallbackName }
  }
}

/**
 * Record that an app had a UI kit uploaded, so the design-kit provenance is
 * inspectable later (e.g. in the debug console). Stamps `designKit` with
 * `source: 'upload'` — the upload counterpart to the catalog `installDesignSystem`
 * producer. Best-effort: instrumentation must never fail the upload.
 */
export async function stampUploadedKitMetadata(
  appId: string,
  zip: JSZip,
  commonPrefix: string,
  fileName: string
): Promise<void> {
  try {
    const ref = await resolveUploadedKitRef(appId, zip, commonPrefix, fileName)
    const designKit: DesignKitRef = { source: 'upload', ...ref }
    new AppMetadataRepository().merge(appId, { designKit })
  } catch (err) {
    logger.warn('route.file-upload.metadata_failed', { appId, fileName, err: String(err) })
  }
}
