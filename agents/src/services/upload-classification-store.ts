import { createForWorkspace } from '../workspace/index.js'
import { logger } from '../logging/index.js'

/**
 * Persisted chat-upload classifications written by FileUploadContextRenderer.
 * The context-manager re-injects these on follow-up turns to rebuild the
 * "Upload handling" guidance, so keeping `slotUrl` current here is what stops
 * the agent from being told to re-register an upload it already placed.
 */
const CLASSIFICATIONS_PATH = 'docs/.upload-classifications.json'

interface PersistedClassificationFile {
  files?: Array<Record<string, unknown>>
}

/**
 * Record the resolved media-slot URL for an already-imported chat upload back
 * into the persisted classification, keyed by the stored upload filename.
 *
 * Best-effort and non-fatal: returns false (and logs at warn) on any failure or
 * when there is nothing to update, so callers can fire-and-forget. Without this,
 * a follow-up turn re-injects guidance that still says "call import_upload" for
 * a file the agent has already registered.
 */
export async function recordUploadSlotUrl(params: {
  appId: string
  storedFilename: string
  slotUrl: string
}): Promise<boolean> {
  const { appId, storedFilename, slotUrl } = params

  try {
    const workspace = createForWorkspace(appId, 'preview')
    if (!workspace) return false

    let parsed: PersistedClassificationFile
    try {
      const view = await workspace.files.view({ path: CLASSIFICATIONS_PATH, limit: 65536 })
      parsed = JSON.parse(view.content) as PersistedClassificationFile
    } catch {
      // No persisted classifications (or unreadable) — nothing to update.
      return false
    }

    if (!Array.isArray(parsed.files)) return false

    let changed = false
    for (const entry of parsed.files) {
      const matches =
        entry.storedUploadFilename === storedFilename || entry.fileName === storedFilename
      if (matches && entry.slotUrl !== slotUrl) {
        entry.slotUrl = slotUrl
        changed = true
      }
    }

    if (!changed) return false

    await workspace.files.write({
      path: CLASSIFICATIONS_PATH,
      content: JSON.stringify(parsed, null, 2),
      encoding: 'utf-8',
    })

    logger.info('upload_classification.slot_url.recorded', { appId, storedFilename, slotUrl })
    return true
  } catch (error) {
    logger.warn('upload_classification.slot_url.record_failed', {
      appId,
      storedFilename,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
