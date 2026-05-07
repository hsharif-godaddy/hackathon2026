import { existsSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()

const SCAN_DIRS = ['src/styles', 'src/pages', 'src/components', 'docs']

function collectWrittenFiles(appPath: string): string[] {
  const results: string[] = []
  for (const dir of SCAN_DIRS) {
    const fullDir = join(appPath, dir)
    if (!existsSync(fullDir)) continue
    for (const entry of readdirSync(fullDir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue
      const entryPath = entry.parentPath
        ? join(relative(appPath, entry.parentPath), entry.name)
        : join(dir, entry.name)
      results.push(entryPath)
    }
  }
  return results
}

export class ZipUploadContextRenderer implements ContextAttachmentRenderer {
  canHandle(type: string): boolean {
    return type === 'zip_upload'
  }

  render(
    _attachment: ContextAttachment,
    _userPrompt: string,
    context?: {
      appId?: string
      appPath?: string
      conversationId?: string
    }
  ): RenderedContext | null {
    const appId = context?.appId
    const app = appId ? appRepo.findById(appId) : null
    const appPath = app?.path || context?.appPath
    if (!appPath) {
      logger.warn('context.renderer.zip_upload.no_app_path', { appId })
      return null
    }

    const written = collectWrittenFiles(appPath)
    if (written.length === 0) {
      return {
        content: 'ZIP upload was processed but no files were found on disk. The upload may have failed.',
        role: 'user',
        insertionOrder: 'after_history',
      }
    }

    const lines = ['The following files were written to disk from the uploaded ZIP:']
    for (const path of written) {
      lines.push(`- ${path}`)
    }

    logger.info('context.renderer.zip_upload.complete', { appId, fileCount: written.length })

    return {
      content: lines.join('\n'),
      role: 'user',
      insertionOrder: 'after_history',
    }
  }

  shouldPersist(_attachment: ContextAttachment): boolean {
    return false
  }
}
