import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'
import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { logger } from '../../logging/index.js'
import { resizeForVision } from '../../utils/image-resize.js'
import { createForWorkspace } from '../../workspace/index.js'

const appRepo = new AppRepository()

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']

interface UploadClassification {
  variant: 'adaptive' | 'spec-driven'
  classification: string
  designDirection: 'full' | 'partial' | 'none'
  contentStructure: 'full' | 'partial' | 'none'
  assetRole: 'logo' | 'hero_image' | 'background' | null
  extractedColors: string[] | null
  extractedPages: string[] | null
  summary: string
}

const CLASSIFICATION_SYSTEM_PROMPT = `You classify files uploaded by users who are building a website. Analyze the file and return a JSON object.

Output ONLY valid JSON matching this schema:
{
  "variant": "adaptive" | "spec-driven",
  "classification": "logo" | "reference_design" | "screenshot" | "photo" | "design_spec" | "site_plan" | "brand_guidelines" | "content_doc" | "generic",
  "designDirection": "full" | "partial" | "none",
  "contentStructure": "full" | "partial" | "none",
  "assetRole": "logo" | "hero_image" | "background" | null,
  "extractedColors": ["#hex", ...] | null,
  "extractedPages": ["Page Name", ...] | null,
  "summary": "Brief description of what this file provides"
}

Rules:
- "variant": "spec-driven" if the file is a build plan, design spec with tokens, or detailed site structure. "adaptive" for everything else (logos, photos, reference images, brand guidelines, content docs).
- "classification": choose the most specific match.
- "designDirection": "full" if it provides complete visual direction (colors, typography, layout). "partial" if some visual cues (a logo with colors, a mood reference). "none" if purely structural/content.
- "contentStructure": "full" if it lists specific pages/sections to build. "partial" if it implies structure. "none" if it's purely visual.
- "assetRole": set only for images that should be placed ON the website (logos, hero photos, background images). null for reference/inspiration images.
- "extractedColors": for logos or design specs, extract 2-6 dominant/specified hex colors. null otherwise.
- "extractedPages": for site plans/specs, list the page names. null otherwise.
- "summary": 1-2 sentences describing what the file provides for the build.`

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

async function classifyImage(buffer: Buffer, fileName: string, userPrompt: string): Promise<{ classification: UploadClassification; dataUrl: string } | null> {
  const mimeType = getMimeType(fileName)
  const { buffer: resized, mimeType: outputMime } = await resizeForVision(buffer, mimeType)
  const dataUrl = `data:${outputMime};base64,${resized.toString('base64')}`

  try {
    const model = await getModel('haiku')
    const result = await generateText({
      model,
      messages: [
        { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
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
    })

    const parsed = JSON.parse(stripCodeFences(result.text)) as UploadClassification
    return { classification: parsed, dataUrl }
  } catch (error) {
    logger.warn('context.renderer.file_upload.classify_image_failed', {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function classifyText(content: string, fileName: string, userPrompt: string): Promise<UploadClassification | null> {
  try {
    const model = await getModel('haiku')
    const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content
    const result = await generateText({
      model,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      prompt: `User's prompt: "${userPrompt}"\n\nFilename: ${fileName}\n\nFile content:\n${truncated}`,
      temperature: 0,
      maxOutputTokens: 500,
      experimental_telemetry: { isEnabled: true, functionId: 'classify-upload' },
    })

    return JSON.parse(stripCodeFences(result.text)) as UploadClassification
  } catch (error) {
    logger.warn('context.renderer.file_upload.classify_text_failed', {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function persistClassifications(
  appPath: string,
  entries: Array<UploadClassification & { fileName: string }>,
): void {
  try {
    // appPath is server-controlled (workspace path); filename is a static literal — no user input in the join.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const classificationPath = join(appPath, 'docs', '.upload-classifications.json')
    mkdirSync(dirname(classificationPath), { recursive: true })
    writeFileSync(classificationPath, JSON.stringify({ files: entries }, null, 2), 'utf-8')
  } catch (err) {
    logger.warn('context.renderer.file_upload.persist_classification_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
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

    const sections: string[] = []
    const assetImages: string[] = []
    const classifications: Array<UploadClassification & { fileName: string }> = []

    for (const file of files) {
      const result = await this.renderSingleFile(file, userPrompt, appId!, workspace)
      if (result) {
        sections.push(result.content)
        if (result.assetImages) {
          assetImages.push(...result.assetImages)
        }
        if (result.classification) {
          classifications.push({ ...result.classification, fileName: file.name })
        }
      }
    }

    if (sections.length === 0) return null

    // Persist every file's classification together so follow-up turns can
    // re-inject all of them — not just the last file processed in the loop.
    if (classifications.length > 0) {
      persistClassifications(appPath, classifications)
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
  ): Promise<{ content: string; assetImages?: string[]; classification?: UploadClassification } | null> {
    const fileName = file.name
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
          content: `Image file "${fileName}" was uploaded but not found on disk.`,
        }
      }

      const result = await classifyImage(buffer, fileName, userPrompt)

      if (result) {
        const sections = [
          '## Upload Classification',
          '',
          '```json',
          JSON.stringify(result.classification, null, 2),
          '```',
          '',
          `Image uploaded to: \`src/assets/${fileName}\``,
        ]

        logger.info('context.renderer.file_upload.image_classified', {
          appId, fileName, classification: result.classification.classification,
          variant: result.classification.variant,
        })

        return {
          content: sections.join('\n'),
          assetImages: [result.dataUrl],
          classification: result.classification,
        }
      }

      // Fallback if classification fails — still provide image for vision
      try {
        const mimeType = getMimeType(fileName)
        const { buffer: resized, mimeType: outputMime } = await resizeForVision(buffer, mimeType)
        const dataUrl = `data:${outputMime};base64,${resized.toString('base64')}`

        return {
          content: `Image uploaded to: \`src/assets/${fileName}\`. Classification unavailable.`,
          assetImages: [dataUrl],
        }
      } catch (err) {
        logger.warn('context.renderer.file_upload.resize_failed', {
          fileName, error: err instanceof Error ? err.message : String(err),
        })
        return {
          content: `Image uploaded to: \`src/assets/${fileName}\`. Classification and vision unavailable.`,
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
        content: `File "${fileName}" was uploaded but not found on disk at \`docs/${fileName}\`.`,
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
        `File written to: \`docs/${fileName}\``,
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
      content: `# Uploaded File: \`docs/${fileName}\`\n\n${content}`,
    }
  }

  shouldPersist(_attachment: ContextAttachment): boolean {
    return false
  }
}
