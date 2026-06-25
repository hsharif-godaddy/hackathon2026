import { getModel } from '@airo/ai-lib'
import { llmMetadataContext } from '@airo/ai-common'
import { generateText } from 'ai'
import { z } from 'zod'
import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { logger } from '../../logging/index.js'
import { fileUploadService } from '../../services/FileUploadService.js'
import {
  buildUploadHandlingGuidance,
  sanitizeUploadFileNameForDisplay,
  shouldAutoRegisterUpload,
  type SlotEligibleAssetRole,
} from '../../services/upload-handling-guidance.js'
import { mediaManifestService } from '../../services/MediaManifestService.js'
import { resizeForVision } from '../../utils/image-resize.js'
import { createForWorkspace } from '../../workspace/index.js'
import {
  readPersistedClassifications,
  persistClassifications,
  type PersistedUploadClassification,
} from './upload-classification-persistence.js'

const appRepo = new AppRepository()

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

// Validated at the SDK boundary via generateObject — the model is forced to
// return this exact shape, so no hand-parsing/JSON-repair is needed. assetRole
// and placementIntent are strict enums (the high-stakes fields); classification
// stays a free string to avoid rejecting valid-but-off-list labels.
// Per-field `.catch(...)` makes a single drifted/omitted field degrade to a
// safe default instead of discarding the entire classification. Defaults are
// chosen to be safe: an unrecognized assetRole → null (not slot-eligible), an
// unrecognized placementIntent → 'unclear' (ask, never auto-place).
const UploadClassificationSchema = z.object({
  variant: z.enum(['adaptive', 'spec-driven']).catch('adaptive'),
  classification: z.string().catch('generic'),
  designDirection: z.enum(['full', 'partial', 'none']).catch('none'),
  contentStructure: z.enum(['full', 'partial', 'none']).catch('none'),
  assetRole: z.enum(['logo', 'hero_image', 'background']).nullable().catch(null),
  placementIntent: z.enum(['display_on_site', 'reference_only', 'unclear']).catch('unclear'),
  extractedColors: z.array(z.string()).nullable().catch(null),
  extractedPages: z.array(z.string()).nullable().catch(null),
  summary: z.string().catch(''),
})

export type UploadClassification = z.infer<typeof UploadClassificationSchema>

const CLASSIFICATION_SYSTEM_PROMPT = `You classify files uploaded by users who are building a website. Analyze the file AND the user's prompt together. Return a JSON object.

Output ONLY valid JSON matching this schema:
{
  "variant": "adaptive" | "spec-driven",
  "classification": "logo" | "reference_design" | "screenshot" | "photo" | "design_spec" | "site_plan" | "brand_guidelines" | "content_doc" | "generic",
  "designDirection": "full" | "partial" | "none",
  "contentStructure": "full" | "partial" | "none",
  "assetRole": "logo" | "hero_image" | "background" | null,
  "placementIntent": "display_on_site" | "reference_only" | "unclear",
  "extractedColors": ["#hex", ...] | null,
  "extractedPages": ["Page Name", ...] | null,
  "summary": "Brief description of what this file provides"
}

Rules:
- "variant": "spec-driven" if the file is a build plan, design spec with tokens, or detailed site structure. "adaptive" for everything else (logos, photos, reference images, brand guidelines, content docs).
- "classification": choose the most specific match.
- "designDirection": "full" if it provides complete visual direction (colors, typography, layout). "partial" if some visual cues (a logo with colors, a mood reference). "none" if purely structural/content.
- "contentStructure": "full" if it lists specific pages/sections to build. "partial" if it implies structure. "none" if it's purely visual.
- "placementIntent" (CRITICAL — read the user's prompt). Decide in this order:
  1. Does the prompt contain an action verb that puts THIS file onto the site or a page — "add", "put", "place", "use this", "insert", "show", "include", "set as", "make this the …", "here is our … for the …"? If yes → "display_on_site". A page/section target ("front page", "homepage", "hero", "menu page", "header") with any such verb is ALWAYS display_on_site. Examples: "add this to front page", "use this as the hero", "put this photo on the menu page", "here is our logo for the header", "add this image to the site", "set this as the background".
  2. Else, does the prompt ask the site to RESEMBLE the file without displaying it — "make it look/feel like this", "similar vibe", "match this style", "use this color scheme", "like this layout", "here's a competitor site"? If yes → "reference_only".
  3. Else (no directive either way, e.g. bare "build my site" or just an image with no instruction) → "unclear".
  Rule of thumb: an explicit request to place/add/use the file on the site is display_on_site even if it does not name a slot. "unclear" is ONLY for genuinely silent prompts — never use it when an action verb directs the file onto the site.
- "assetRole": set ONLY from what the PROMPT asks for — never from how the image merely looks. Use "hero_image" or "background" only when the prompt explicitly puts THIS image in that role ("use as the hero", "make this the hero", "set as the background"). Use "logo" only when the prompt calls it a logo. In EVERY other case use null — including a display_on_site image the user is placing in a specific or NEW location ("make one more section", "add a card", "use these in a gallery", "put it in the about section"), and generic site content (product photo, team headshot, gallery item), even if the photo looks like a hero or background shot. Also null for reference_only and unclear. (hero_image/background auto-register into the SINGLE canonical hero/background slot, so tagging a section/gallery image as hero_image silently overwrites the real hero — only do it when the user actually asked for the hero/background.)
- "extractedColors": for logos or design specs, extract 2-6 dominant/specified hex colors. null otherwise.
- "extractedPages": for site plans/specs, list the page names. null otherwise.
- "summary": 1-2 sentences describing what the file provides for the build.`

function getMimeType(fileName: string): string {
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  }
  return mimeMap[ext] || 'application/octet-stream'
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n')
    const lastFence = trimmed.lastIndexOf('```')
    if (firstNewline !== -1 && lastFence > firstNewline) {
      return trimmed.slice(firstNewline + 1, lastFence).trim()
    }
  }
  return trimmed
}

/**
 * Parse the model's JSON text and validate it against the schema, returning
 * null (logged) on malformed JSON or schema mismatch so callers fall back
 * safely. We use generateText + validate-here rather than generateObject
 * because the GoCode anthropic endpoint rejects object-mode requests — this
 * keeps the working transport while still guaranteeing a typed, valid result.
 */
function parseClassification(text: string, fileName: string): UploadClassification | null {
  let raw: unknown
  try {
    raw = JSON.parse(stripCodeFences(text))
  } catch (error) {
    logger.warn('context.renderer.file_upload.classification_parse_failed', {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
  const result = UploadClassificationSchema.safeParse(raw)
  if (!result.success) {
    logger.warn('context.renderer.file_upload.classification_invalid', {
      fileName,
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    })
    return null
  }
  return result.data
}

// Context-build (where classification runs) happens outside the agent loop's
// llmMetadataContext, so the GoCode proxy would receive no litellm_metadata and
// reject the call. Establish a minimal context around every classify request.
const CLASSIFIER_METADATA = {
  user: 'airo-builder:upload-classifier',
  tags: ['source:upload-classifier'],
}

async function classifyImage(buffer: Buffer, fileName: string, userPrompt: string): Promise<{ classification: UploadClassification; dataUrl: string } | null> {
  const mimeType = getMimeType(fileName)
  const { buffer: resized, mimeType: outputMime } = await resizeForVision(buffer, mimeType)
  const dataUrl = `data:${outputMime};base64,${resized.toString('base64')}`

  try {
    const model = await getModel('haiku')
    // The system prompt MUST be passed as the `system` option, not as a
    // system-role entry in `messages`: the Anthropic (GoCode) endpoint takes
    // `system` as a top-level field and rejects a system message in the array
    // with HTTP 400.
    const result = await llmMetadataContext.run(CLASSIFIER_METADATA, () => generateText({
      model,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: dataUrl },
            { type: 'text', text: `User's prompt: "${userPrompt}"\n\nClassify this uploaded image.` },
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: 500,
      experimental_telemetry: { isEnabled: true, functionId: 'classify-upload' },
    }))

    const classification = parseClassification(result.text, fileName)
    return classification ? { classification, dataUrl } : null
  } catch (error) {
    const apiError = error as { statusCode?: number; responseBody?: string }
    logger.warn('context.renderer.file_upload.classify_image_failed', {
      fileName,
      error: error instanceof Error ? error.message : String(error),
      ...(apiError.statusCode !== undefined ? { statusCode: apiError.statusCode } : {}),
      ...(typeof apiError.responseBody === 'string'
        ? { responseBody: apiError.responseBody.slice(0, 500) }
        : {}),
    })
    return null
  }
}

/**
 * Public wrapper for evals/tooling: classify a single uploaded image from its
 * raw bytes + the user's prompt, returning just the classification (or null on
 * failure). Used by the classifier accuracy eval to verify placementIntent.
 */
export async function classifyUploadImage(
  buffer: Buffer,
  fileName: string,
  userPrompt: string,
): Promise<UploadClassification | null> {
  // classifyImage already establishes the llmMetadataContext, so callers
  // (eval, selected-assets renderer) need no extra wrapping here.
  const result = await classifyImage(buffer, fileName, userPrompt)
  return result?.classification ?? null
}

async function classifyText(content: string, fileName: string, userPrompt: string): Promise<UploadClassification | null> {
  try {
    const model = await getModel('haiku')
    const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content
    const result = await llmMetadataContext.run(CLASSIFIER_METADATA, () => generateText({
      model,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      prompt: `User's prompt: "${userPrompt}"\n\nFilename: ${fileName}\n\nFile content:\n${truncated}`,
      temperature: 0,
      maxOutputTokens: 500,
      experimental_telemetry: { isEnabled: true, functionId: 'classify-upload' },
    }))

    return parseClassification(result.text, fileName)
  } catch (error) {
    logger.warn('context.renderer.file_upload.classify_text_failed', {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

interface RegisterChatUploadSlotResult {
  slotUrl: string | null
  deflectedFromCanonical: boolean
}

async function registerChatUploadSlot(
  appId: string,
  storedUploadFilename: string,
  assetRole: SlotEligibleAssetRole
): Promise<RegisterChatUploadSlotResult> {
  try {
    const result = await mediaManifestService.importChatUploadToSlot(appId, {
      filename: storedUploadFilename,
      assetRole,
      createIfMissing: true,
    })

    if (!result.success) {
      logger.warn('context.renderer.file_upload.slot_register_failed', {
        appId,
        storedUploadFilename,
        assetRole,
        error: result.error,
      })
      return { slotUrl: null, deflectedFromCanonical: false }
    }

    logger.info('context.renderer.file_upload.slot_registered', {
      appId,
      storedUploadFilename,
      assetRole,
      slotPath: result.slotPath,
      deflectedFromCanonical: result.deflectedFromCanonical ?? false,
    })

    return { slotUrl: result.slotUrl, deflectedFromCanonical: result.deflectedFromCanonical ?? false }
  } catch (error) {
    logger.warn('context.renderer.file_upload.slot_register_error', {
      appId,
      storedUploadFilename,
      assetRole,
      error: error instanceof Error ? error.message : String(error),
    })
    return { slotUrl: null, deflectedFromCanonical: false }
  }
}

export class FileUploadContextRenderer implements ContextAttachmentRenderer {
  canHandle(type: string): boolean {
    return type === 'file_upload'
  }

  async render(
    attachment: ContextAttachment,
    userPrompt: string,
    context?: {
      appId?: string
      appPath?: string
      conversationId?: string
      isContinuation?: boolean
    }
  ): Promise<RenderedContext | null> {
    const rawData = attachment.data as
      | { name?: string; isDesignMd?: boolean; isImage?: boolean }
      | { files?: Array<{ name: string; isDesignMd?: boolean; isImage?: boolean }> }
      | undefined

    if (!rawData) return null

    const files: Array<{ name: string; isDesignMd?: boolean; isImage?: boolean }> =
      'files' in rawData && Array.isArray(rawData.files)
        ? rawData.files
        : 'name' in rawData && rawData.name
          ? [{ name: rawData.name, isDesignMd: (rawData as { isDesignMd?: boolean }).isDesignMd, isImage: (rawData as { isImage?: boolean }).isImage }]
          : []

    if (files.length === 0) return null

    const appId = context?.appId
    const app = appId ? appRepo.findById(appId) : null
    const appPath = app?.path || context?.appPath
    if (!appPath) {
      logger.warn('context.renderer.file_upload.no_app_path', { appId })
      return null
    }

    const workspace = createForWorkspace(appId!, 'preview')
    if (!workspace) {
      logger.warn('context.renderer.file_upload.workspace_unavailable', { appId })
      return {
        content: files.map(f => `File "${f.name}" was uploaded but workspace is unavailable.`).join('\n'),
        role: 'user',
        insertionOrder: 'after_history',
      }
    }

    // A fresh user turn (iteration 0) with an attached file is an explicit
    // user action — always classify it against the user's own message, even if
    // the same filename was classified on a previous turn (the user may be
    // re-uploading with a new intent).
    //
    // On a handoff / auto-continue turn (iteration > 0) the SAME attachment is
    // re-fed with a non-user prompt; re-classifying there would waste a vision
    // call and could contradict the real classification. Skip those — the
    // context manager re-injects the persisted result every turn.
    const persisted = await readPersistedClassifications(workspace)
    const freshFiles = context?.isContinuation
      ? files.filter((f) => !persisted.has(f.name))
      : files
    if (freshFiles.length === 0) return null

    const sections: string[] = []
    const assetImages: string[] = []
    const classifications: PersistedUploadClassification[] = []

    // Classify all files concurrently — each is an independent haiku vision
    // call, so a multi-image upload shouldn't pay N× latency back-to-back on
    // this interactive path. Auto-register side effects inside renderSingleFile
    // are serialized by importChatUploadToSlot's per-app lock, so parallelism is
    // safe. Results are collected in input order (Promise.all preserves order)
    // for deterministic section/classification ordering.
    // Each file is isolated: a throw from renderSingleFile (e.g. an unguarded
    // disk read in findMatchingUpload) must not propagate to render() — the
    // context manager catches there and drops ALL attachment context, which
    // would silently blank the whole upload. A failed file resolves to null.
    const results = await Promise.all(
      freshFiles.map(async (file) => {
        try {
          return { file, result: await this.renderSingleFile(file, userPrompt, appId!, workspace) }
        } catch (err) {
          logger.warn('context.renderer.file_upload.render_single_failed', {
            appId,
            fileName: file.name,
            error: err instanceof Error ? err.message : String(err),
          })
          return { file, result: null }
        }
      })
    )

    for (const { file, result } of results) {
      if (!result) continue
      sections.push(result.content)
      if (result.assetImages) {
        assetImages.push(...result.assetImages)
      }
      if (result.classification) {
        classifications.push({
          ...result.classification,
          fileName: file.name,
          ...(result.slotUrl ? { slotUrl: result.slotUrl } : {}),
          ...(result.storedUploadFilename ? { storedUploadFilename: result.storedUploadFilename } : {}),
          ...(result.deflectedFromCanonical ? { deflectedFromCanonical: true } : {}),
        })
      }
    }

    if (sections.length === 0) return null

    // Persist every file's classification together so follow-up turns can
    // re-inject all of them — not just the last file processed in the loop.
    if (classifications.length > 0 && appId) {
      await persistClassifications(workspace, classifications, appId)
    }

    return {
      content: sections.join('\n\n---\n\n'),
      role: 'user',
      insertionOrder: 'after_history',
      ...(assetImages.length > 0 && { assetImages }),
    }
  }

  private async renderSingleFile(
    file: { name: string; isDesignMd?: boolean; isImage?: boolean },
    userPrompt: string,
    appId: string,
    workspace: NonNullable<ReturnType<typeof createForWorkspace>>,
  ): Promise<{
    content: string
    assetImages?: string[]
    classification?: UploadClassification
    slotUrl?: string
    storedUploadFilename?: string
    deflectedFromCanonical?: boolean
  } | null> {
    const fileName = file.name
    // Display-safe variant for agent-facing markdown; raw fileName is still
    // used for disk lookups (workspace download, findMatchingUpload).
    const displayName = sanitizeUploadFileNameForDisplay(fileName)
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
    const isImage = file.isImage || IMAGE_EXTENSIONS.includes(ext)

    if (isImage) {
      let buffer: Buffer
      try {
        const downloadResult = await workspace.files.download({ path: `src/assets/${fileName}` })
        buffer = downloadResult.data
      } catch (err) {
        logger.warn('context.renderer.file_upload.image_not_found', {
          appId,
          fileName,
          error: err instanceof Error ? err.message : String(err),
        })
        return {
          content: `Image file "${displayName}" was uploaded but not found on disk.`,
        }
      }

      const result = await classifyImage(buffer, fileName, userPrompt)

      if (result) {
        const match = await fileUploadService.findMatchingUpload(appId, fileName)
        const storedUploadFilename = match?.file.filename ?? null
        let slotUrl: string | null = null

        const handlingInput = {
          fileName,
          assetRole: result.classification.assetRole,
          // Non-nullable enum on UploadClassification (schema .catch) — no fallback.
          placementIntent: result.classification.placementIntent,
          storedUploadFilename,
          isImage: true,
        }

        // Deliberate side effect inside a context renderer: the auto-register
        // decision depends on the classifier result computed here, so this is
        // the earliest point where we know a hero/background upload should
        // become a slot. It is safe to run here because importChatUploadToSlot
        // takes a per-app lock, de-duplicates by upload filename (re-renders of
        // the same turn are idempotent), and failures are non-fatal — a null
        // slotUrl just falls back to the import_upload guidance below.
        let deflectedFromCanonical: boolean = false
        if (shouldAutoRegisterUpload(handlingInput) && storedUploadFilename) {
          const registered = await registerChatUploadSlot(
            appId,
            storedUploadFilename,
            result.classification.assetRole as SlotEligibleAssetRole
          )
          slotUrl = registered.slotUrl
          deflectedFromCanonical = registered.deflectedFromCanonical
        }

        const sections = [
          '## Upload Classification',
          '',
          '```json',
          JSON.stringify(result.classification, null, 2),
          '```',
          '',
          `Image uploaded to: \`src/assets/${displayName}\``,
          '',
          buildUploadHandlingGuidance({ ...handlingInput, slotUrl, deflectedFromCanonical }),
        ]

        logger.info('context.renderer.file_upload.image_classified', {
          appId, fileName, classification: result.classification.classification,
          variant: result.classification.variant,
        })

        return {
          content: sections.join('\n'),
          assetImages: [result.dataUrl],
          classification: result.classification,
          ...(slotUrl ? { slotUrl } : {}),
          ...(storedUploadFilename ? { storedUploadFilename } : {}),
          ...(deflectedFromCanonical ? { deflectedFromCanonical: true } : {}),
        }
      }

      // Fallback if classification fails — still provide image for vision
      try {
        const mimeType = getMimeType(fileName)
        const { buffer: resized, mimeType: outputMime } = await resizeForVision(buffer, mimeType)
        const dataUrl = `data:${outputMime};base64,${resized.toString('base64')}`

        return {
          content: `Image uploaded to: \`src/assets/${displayName}\`. Classification unavailable.`,
          assetImages: [dataUrl],
        }
      } catch (err) {
        logger.warn('context.renderer.file_upload.resize_failed', {
          fileName, error: err instanceof Error ? err.message : String(err),
        })
        return {
          content: `Image uploaded to: \`src/assets/${displayName}\`. Classification and vision unavailable.`,
        }
      }
    }

    // Text file
    let content: string
    try {
      const viewResult = await workspace.files.view({ path: `docs/${fileName}`, limit: 10000 })
      content = viewResult.content
    } catch (err) {
      logger.warn('context.renderer.file_upload.text_not_found', {
        appId,
        fileName,
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        content: `File "${displayName}" was uploaded but not found on disk at \`docs/${displayName}\`.`,
      }
    }
    const classification = await classifyText(content, fileName, userPrompt)

    if (classification) {
      const sections = [
        '## Upload Classification',
        '',
        '```json',
        JSON.stringify(classification, null, 2),
        '```',
        '',
        `File written to: \`docs/${displayName}\``,
        '',
        '## File Content',
        '',
        content,
      ]

      logger.info('context.renderer.file_upload.text_classified', {
        appId, fileName, classification: classification.classification,
        variant: classification.variant, size: content.length,
      })

      return {
        content: sections.join('\n'),
        classification,
      }
    }

    // Fallback — provide content without classification
    return {
      content: `# Uploaded File: \`docs/${displayName}\`\n\n${content}`,
    }
  }

  shouldPersist(_attachment: ContextAttachment): boolean {
    return false
  }
}
