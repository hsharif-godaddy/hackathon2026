import { markUploadsPlaced } from './renderers/upload-classification-persistence.js'

/**
 * Record the resolved media-slot URL for an already-imported chat upload back
 * into the persisted classification, and mark it placed, so a follow-up turn
 * does not re-inject "call import_upload" for a file the agent already
 * registered. Best-effort and non-fatal — callers fire-and-forget.
 *
 * Thin wrapper over {@link markUploadsPlaced}, which owns the per-app lock over
 * `docs/.upload-classifications.json`.
 */
export async function recordUploadSlotUrl(params: {
  appId: string
  storedFilename: string
  slotUrl: string
}): Promise<boolean> {
  return markUploadsPlaced({
    appId: params.appId,
    storedFilename: params.storedFilename,
    slotUrl: params.slotUrl,
  })
}
