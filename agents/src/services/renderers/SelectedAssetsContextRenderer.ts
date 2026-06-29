import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../../logging/index.js'
import { readUploadedFileContent, readAgentUploadAsBase64 } from '../helpers/ContextFormatter.js'
import { resizeForVision } from '../../utils/image-resize.js'
import { classifyAndGuideChatUploadImage } from '../chat-upload-classification.js'
import { buildUploadHandlingGuidance, type UploadPlacementIntent } from '../upload-handling-guidance.js'
import { createForWorkspace } from '../../workspace/index.js'
import { extractStoredUploadFilename } from '../upload-stored-filename.js'
import { fileUploadService } from '../FileUploadService.js'
import {
  readPersistedClassifications,
  persistClassifications,
  type PersistedUploadClassification,
} from './upload-classification-persistence.js'

interface SelectedAsset {
  mediaType: 'IMAGE' | 'VIDEO' | 'PDF' | 'FILE'
  sourceType: string
  imageUrl: string
  filename?: string
  contentType?: string
  size?: number
  dimensions?: {
    width: number
    height: number
  }
  thumbnailUrl?: string
  altText?: string
  videoUrl?: string
  id?: string
  urlHash?: string
  width?: number
  height?: number
}

// Re-exported so existing importers (and tests) keep a stable import path
// while the parser itself lives in the shared module imported above.
export { extractStoredUploadFilename }

function inferVideoPlacementIntent(userPrompt: string): UploadPlacementIntent {
  return /\b(add|replace|use|set|put|place|insert|embed)\b/i.test(userPrompt) ? 'display_on_site' : 'unclear'
}

export class SelectedAssetsContextRenderer implements ContextAttachmentRenderer<SelectedAsset[]> {
  canHandle(type: string): boolean {
    return type === 'selected_assets'
  }

  private isSvg(asset: SelectedAsset): boolean {
    if (asset.contentType === 'image/svg+xml') return true
    if (asset.filename && asset.filename.toLowerCase().endsWith('.svg')) return true
    return false
  }

  async render(
    attachment: ContextAttachment<SelectedAsset[]>,
    userPrompt: string,
    context?: { appId?: string; appPath?: string; conversationId?: string; isContinuation?: boolean }
  ): Promise<RenderedContext | null> {
    try {
      const assets = attachment.data

      if (!assets || !Array.isArray(assets) || assets.length === 0) {
        return null
      }

      const appId = context?.appId

      // On a fresh user turn (iteration 0) always classify against the user's
      // own message. On a handoff/auto-continue turn (isContinuation) the same
      // attachment is re-fed with a non-user prompt, so reuse the persisted
      // result (re-injected by the context manager) instead of re-running the
      // haiku vision call, which would waste spend and could contradict it.
      const workspace = appId ? createForWorkspace(appId, 'preview') : null
      const persisted = workspace ? await readPersistedClassifications(workspace) : new Map<string, PersistedUploadClassification>()
      const reusePersisted = context?.isContinuation === true
      const freshEntries: PersistedUploadClassification[] = []

      // Pre-pass: for each uploaded raster image, fetch it once and reuse the
      // bytes for BOTH placement-intent classification (→ per-file guidance) and
      // the vision inputs below. This is the develop-chat counterpart to the
      // file_upload renderer — without it, mid-conversation uploads get no
      // intent classification and reference images get wrongly embedded.
      const uploadedImageData = new Map<number, { visionDataUrl: string; guidance: string | null; summary: string | null }>()
      await Promise.all(
        assets.map(async (asset, index) => {
          if (
            asset.mediaType !== 'IMAGE' ||
            asset.sourceType !== 'upload' ||
            !asset.imageUrl ||
            this.isSvg(asset)
          ) {
            return
          }
          try {
            const dataUrl = await readAgentUploadAsBase64(asset.imageUrl)
            if (!dataUrl) {
              // No bytes → no vision summary → the agent falls back to
              // upload-order guessing (the swap this renderer exists to avoid).
              // Log so that failure is observable rather than silent.
              logger.warn('context.attachment.selected_assets.no_upload_bytes', { filename: asset.filename })
              return
            }
            const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
            if (!match || !match[1] || !match[2]) {
              logger.warn('context.attachment.selected_assets.bad_data_url', { filename: asset.filename })
              return
            }
            const inputBuffer = Buffer.from(match[2], 'base64')
            const { buffer: resized, mimeType: outputMime } = await resizeForVision(inputBuffer, match[1])
            const visionDataUrl = `data:${outputMime};base64,${resized.toString('base64')}`

            let guidance: string | null = null
            // Vision-derived content description for THIS image, bound to its
            // filename below. Lets the agent match the user's words ("the label
            // view", "the front") to the correct file by content instead of
            // guessing by upload order — the swap that lands look-alike photos
            // in the wrong slots.
            let summary: string | null = null
            if (appId && asset.filename) {
              const priorEntry = persisted.get(asset.filename)
              if (priorEntry && reusePersisted) {
                // Continuation turn — reuse the prior classification, no LLM call.
                guidance = buildUploadHandlingGuidance({
                  fileName: priorEntry.fileName,
                  assetRole: priorEntry.assetRole ?? null,
                  placementIntent: priorEntry.placementIntent ?? 'unclear',
                  slotUrl: priorEntry.slotUrl ?? null,
                  storedUploadFilename: priorEntry.storedUploadFilename ?? null,
                  isImage: true,
                  deflectedFromCanonical: priorEntry.deflectedFromCanonical ?? false,
                })
                summary = priorEntry.summary ?? null
                if (!summary) {
                  // A persisted entry from before content-binding existed (or one
                  // that classified without a summary) drops the "Shows
                  // (auto-detected)" line on this continuation turn — the agent
                  // is back to guessing by order. Surface it.
                  logger.warn('context.attachment.selected_assets.persisted_summary_missing', {
                    filename: asset.filename,
                  })
                }
              } else {
                const result = await classifyAndGuideChatUploadImage({
                  appId,
                  fileName: asset.filename,
                  buffer: inputBuffer,
                  userPrompt,
                  // The asset's imageUrl encodes the UNIQUE stored filename
                  // (/files/uploads/{appId}/{storedFilename}); pass it so the
                  // stored filename isn't re-resolved by display name, which
                  // would return the newest upload when two distinct assets
                  // share a name (the same-name collision).
                  storedFilename: extractStoredUploadFilename(asset.imageUrl),
                })
                guidance = result.guidance
                summary = result.classification?.summary ?? null
                if (!summary) {
                  // No content summary for this image — either the classify
                  // returned a classification without one, or returned none at
                  // all (hadClassification disambiguates). Either way the "Shows
                  // (auto-detected)" binding is dropped and the agent must guess
                  // placement by order. Surface it.
                  logger.warn('context.attachment.selected_assets.summary_missing', {
                    filename: asset.filename,
                    hadClassification: !!result.classification,
                  })
                }
                if (result.classification) {
                  freshEntries.push({
                    ...result.classification,
                    fileName: asset.filename,
                    ...(result.slotUrl ? { slotUrl: result.slotUrl } : {}),
                    ...(result.storedUploadFilename ? { storedUploadFilename: result.storedUploadFilename } : {}),
                    ...(result.deflectedFromCanonical ? { deflectedFromCanonical: true } : {}),
                  })
                }
              }
            } else {
              // The pre-pass above already narrowed to image uploads we want to
              // bind, so a missing appId/filename here is a real degrade — no
              // classification runs, the "Shows (auto-detected)" line is
              // dropped, and the agent falls back to order-guessing.
              logger.warn('context.attachment.selected_assets.binding_skipped', {
                hasAppId: !!appId,
                hasFilename: !!asset.filename,
              })
            }
            uploadedImageData.set(index, { visionDataUrl, guidance, summary })
          } catch (err) {
            logger.warn('context.attachment.selected_assets.image_fetch_failed', {
              filename: asset.filename,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        })
      )

      // Pre-pass: for each uploaded VIDEO, resolve the stored filename and
      // build placement guidance. No vision/LLM call needed — placement intent
      // is inferred from the user prompt via a simple regex heuristic.
      const uploadedVideoData = new Map<number, { guidance: string | null }>()
      await Promise.all(
        assets.map(async (asset: SelectedAsset, index: number) => {
          if (
            asset.mediaType !== 'VIDEO' ||
            asset.sourceType !== 'upload' ||
            !asset.filename
          ) {
            return
          }
          const priorEntry: PersistedUploadClassification | undefined = persisted.get(asset.filename)
          if (priorEntry && reusePersisted) {
            // Continuation turn — reuse persisted entry so the same stored
            // filename survives without re-deriving from the URL.
            uploadedVideoData.set(index, {
              guidance: buildUploadHandlingGuidance({
                fileName: priorEntry.fileName,
                assetRole: null,
                placementIntent: priorEntry.placementIntent ?? 'unclear',
                slotUrl: priorEntry.slotUrl ?? null,
                storedUploadFilename: priorEntry.storedUploadFilename ?? null,
                isVideo: true,
                isImage: false,
              }),
            })
            return
          }
          // videoUrl and imageUrl both carry the upload URL for VIDEO assets
          // (set by mapUploadedFilesToAssetItems in ChatPane). Prefer videoUrl.
          const urlForStored: string | undefined = asset.videoUrl || asset.imageUrl || undefined
          const storedUploadFilename: string | null = extractStoredUploadFilename(urlForStored)
            ?? await (async function resolveStoredUploadFilename(): Promise<string | null> {
              if (!appId) return null
              try {
                return (await fileUploadService.findMatchingUpload(appId, asset.filename!))?.file.filename ?? null
              } catch (err) {
                logger.warn('context.attachment.selected_assets.video_stored_filename_lookup_failed', {
                  filename: asset.filename,
                  error: err instanceof Error ? err.message : String(err),
                })
                return null
              }
            })()
          const placementIntent: UploadPlacementIntent = inferVideoPlacementIntent(userPrompt)
          const guidance: string = buildUploadHandlingGuidance({
            fileName: asset.filename,
            assetRole: null,
            placementIntent,
            storedUploadFilename,
            isVideo: true,
            isImage: false,
          })
          uploadedVideoData.set(index, { guidance })
          if (appId) {
            freshEntries.push({
              fileName: asset.filename,
              variant: 'adaptive',
              classification: 'video',
              designDirection: 'none',
              contentStructure: 'none',
              assetRole: null,
              placementIntent,
              extractedColors: null,
              extractedPages: null,
              summary: '',
              ...(storedUploadFilename ? { storedUploadFilename } : {}),
            })
          }
        })
      )

      // Persist newly-classified develop-chat uploads (merged) so follow-up
      // turns re-inject them and skip re-classifying — mirrors the file_upload
      // path and keeps both upload paths symmetric.
      if (workspace && appId && freshEntries.length > 0) {
        await persistClassifications(workspace, freshEntries, appId)
      }

      const formattedAssetPromises = assets.map(async (asset, index) => {
        const parts: string[] = []

        parts.push(`**Asset ${index + 1}:** ${asset.mediaType}`)

        if (asset.filename) {
          // Sanitize filename for display: strip newlines and control chars to prevent structure injection
          const displayFilename = asset.filename.replace(/[\n\r\t\0]/g, '_').substring(0, 200)
          parts.push(`- Filename: ${displayFilename}`)
          // Bind this file's auto-detected content to its filename so the agent
          // picks the right file by what it SHOWS, not by upload order. Critical
          // when multiple look-alike images arrive together (front/back/label).
          const summary: string | null | undefined = uploadedImageData.get(index)?.summary
          if (summary) {
            const safeSummary: string = summary.replace(/[\n\r\t\0]/g, ' ').substring(0, 300)
            parts.push(`- Shows (auto-detected): ${safeSummary}`)
          }
        }

        if (asset.sourceType) {
          parts.push(`- Source: ${asset.sourceType}`)
        }

        if (asset.dimensions) {
          parts.push(`- Dimensions: ${asset.dimensions.width}x${asset.dimensions.height}`)
        }

        if (asset.size) {
          const sizeMB = (asset.size / (1024 * 1024)).toFixed(2)
          parts.push(`- Size: ${sizeMB} MB`)
        }

        if (asset.contentType) {
          parts.push(`- Type: ${asset.contentType}`)
        }

        if (asset.altText) {
          parts.push(`- Alt Text: ${asset.altText}`)
        }

        if (asset.imageUrl && asset.sourceType !== 'upload') {
          parts.push(`- URL: ${asset.imageUrl}`)
        }

        if (asset.videoUrl && asset.sourceType !== 'upload') {
          parts.push(`- Video URL: ${asset.videoUrl}`)
        }

        // Handle FILE uploads: read content from disk
        if (asset.mediaType === 'FILE' && asset.sourceType === 'upload' && asset.imageUrl && asset.filename) {
          const fileContent = await readUploadedFileContent(asset.imageUrl, asset.filename)
          if (fileContent) {
            parts.push('')
            parts.push(`File Content:`)
            const escapedContent = fileContent.replace(/~{3,}/g, (m) => '\\' + m)
            parts.push('~~~')
            parts.push(escapedContent)
            parts.push('~~~')
            parts.push('')
            parts.push('This is an uploaded instruction file. The content is provided above - use it as instructions, data, or reference material.')
          } else {
            parts.push('')
            parts.push('⚠️ Could not read file content - file may be missing or unreadable')
          }
        }

        // Handle uploaded VIDEO: include placement guidance with stored filename.
        if (asset.sourceType === 'upload' && asset.filename && asset.mediaType === 'VIDEO') {
          const guidance: string | null | undefined = uploadedVideoData.get(index)?.guidance
          if (guidance) {
            parts.push('')
            parts.push(guidance)
          } else {
            parts.push('')
            parts.push('⚠️ Could not resolve video upload placement guidance — use `media({ action: "listUploadedFiles" })` to find the stored filename, then `import_upload`.')
            const fallbackVideoUrl: string | undefined = asset.videoUrl || asset.imageUrl || undefined
            if (fallbackVideoUrl) {
              parts.push(`- Video URL: ${fallbackVideoUrl}`)
            }
          }
        }

        // Handle uploaded IMAGE/PDF: include placement guidance.
        if (asset.sourceType === 'upload' && asset.filename && (asset.mediaType === 'IMAGE' || asset.mediaType === 'PDF')) {
          const guidance = uploadedImageData.get(index)?.guidance
          if (asset.mediaType === 'IMAGE' && guidance) {
            // Intent-classified guidance (display vs reference vs logo vs
            // unclear) replaces the blanket "copy to public/assets" steering so
            // reference/inspiration images are not embedded.
            parts.push('')
            parts.push(guidance)
          } else {
            // Fallback (PDF, or image where classification was unavailable):
            // keep the original copy-to-project guidance.
            // Sanitize filename: strip path separators, quotes, control chars; clamp length
            const filename = asset.filename
              .replace(/[/\\:"'`\n\r\t\0]/g, '_')
              .substring(0, 200)
            const subdir = asset.mediaType === 'IMAGE' ? 'assets' : 'data'
            const projectPath = `public/${subdir}/${filename}`
            const refPath = `/${subdir}/${filename}`

            parts.push('')
            parts.push('UPLOADED FILE - To use in project:')
            parts.push(`- str_replace_based_edit_tool({ command: "create", path: "${projectPath}", file_text: "" })`)
            parts.push(`- Target filename MUST exactly match "${filename}" for auto-resolution`)
            if (asset.mediaType === 'IMAGE') {
              parts.push(`- Reference: <img src="${refPath}" alt="description" />`)
            } else {
              parts.push(`- Reference: <a href="${refPath}">Download PDF</a>`)
            }
            parts.push('- NEVER reference /files/uploads/ URLs in code')
          }
        }

        return parts.join('\n')
      })

      const formattedAssets = (await Promise.all(formattedAssetPromises)).join('\n\n')

      // Vision inputs were fetched + resized once in the pre-pass above. Emit in
      // asset order for determinism.
      const assetImages: string[] = []
      for (let index = 0; index < assets.length; index++) {
        const info = uploadedImageData.get(index)
        if (info) {
          assetImages.push(info.visionDataUrl)
        }
      }

      const content = `### Selected Assets from Asset Manager

${formattedAssets}`

      return {
        role: 'user',
        content,
        insertionOrder: 'after_history',
        ...(assetImages.length > 0 && { assetImages })
      }
    } catch (error) {
      logger.error('context.attachment.render.selected_assets.error', {
        error: error instanceof Error ? error.message : String(error),
        attachmentType: attachment.type
      })
      return null
    }
  }

  shouldPersist(attachment: ContextAttachment<SelectedAsset[]>): boolean {
    return attachment.persistence === 'save'
  }
}
