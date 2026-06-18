import { fileUploadService } from './FileUploadService.js'
import { mediaManifestService } from './MediaManifestService.js'
import { classifyUploadImage, type UploadClassification } from './renderers/FileUploadContextRenderer.js'
import {
  buildUploadHandlingGuidance,
  shouldAutoRegisterUpload,
  type SlotEligibleAssetRole,
} from './upload-handling-guidance.js'
import { logger } from '../logging/index.js'

export interface ChatUploadImageGuidance {
  classification: UploadClassification | null
  /** Per-file "## Upload handling" block, or null when classification failed. */
  guidance: string | null
  /** Set when a hero/background upload was auto-registered into a media slot. */
  slotUrl: string | null
  /** Internal stored filename (for import_upload), if the upload was matched. */
  storedUploadFilename: string | null
}

/**
 * Classify an uploaded chat image's placement intent and produce the per-file
 * "Upload handling" guidance, auto-registering hero/background uploads into a
 * media slot when the intent is display_on_site.
 *
 * Shared by both upload context renderers — the `file_upload` path (initial
 * build / auto-send) and the `selected_assets` path (mid-conversation develop
 * chat) — so intent classification behaves identically regardless of how the
 * image reached the agent.
 */
export async function classifyAndGuideChatUploadImage(params: {
  appId: string
  fileName: string
  buffer: Buffer
  userPrompt: string
}): Promise<ChatUploadImageGuidance> {
  const { appId, fileName, buffer, userPrompt } = params

  const classification = await classifyUploadImage(buffer, fileName, userPrompt)
  if (!classification) {
    return { classification: null, guidance: null, slotUrl: null, storedUploadFilename: null }
  }

  logger.info('chat_upload.classify_guide.classified', {
    appId,
    fileName,
    placementIntent: classification.placementIntent,
    assetRole: classification.assetRole,
    classification: classification.classification,
  })

  const match = await fileUploadService.findMatchingUpload(appId, fileName)
  const storedUploadFilename = match?.file.filename ?? null

  const handlingInput = {
    fileName,
    assetRole: classification.assetRole,
    // placementIntent is a non-nullable enum on UploadClassification (schema
    // .catch('unclear')) — no fallback needed here.
    placementIntent: classification.placementIntent,
    storedUploadFilename,
    isImage: true,
  }

  let slotUrl: string | null = null
  if (shouldAutoRegisterUpload(handlingInput) && storedUploadFilename) {
    try {
      const result = await mediaManifestService.importChatUploadToSlot(appId, {
        filename: storedUploadFilename,
        assetRole: classification.assetRole as SlotEligibleAssetRole,
        createIfMissing: true,
      })
      if (result.success) {
        slotUrl = result.slotUrl
        logger.info('chat_upload.classify_guide.slot_registered', {
          appId,
          storedUploadFilename,
          slotPath: result.slotPath,
        })
      } else {
        logger.warn('chat_upload.classify_guide.slot_register_failed', {
          appId,
          storedUploadFilename,
          error: result.error,
        })
      }
    } catch (error) {
      logger.warn('chat_upload.classify_guide.slot_register_error', {
        appId,
        storedUploadFilename,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const guidance = buildUploadHandlingGuidance({ ...handlingInput, slotUrl })
  return { classification, guidance, slotUrl, storedUploadFilename }
}
