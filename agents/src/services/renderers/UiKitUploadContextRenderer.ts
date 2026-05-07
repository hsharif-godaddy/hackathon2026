import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()

function collectFiles(dir: string, base: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, base))
    } else {
      results.push(relative(base, full))
    }
  }
  return results
}

export class UiKitUploadContextRenderer implements ContextAttachmentRenderer {
  canHandle(type: string): boolean {
    return type === 'ui_kit_upload'
  }

  render(
    attachment: ContextAttachment,
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
      logger.warn('context.renderer.ui_kit_upload.no_app_path', { appId })
      return null
    }

    const kitPath = join(appPath, 'docs', 'ui-kit')
    if (!existsSync(kitPath)) {
      logger.warn('context.renderer.ui_kit_upload.kit_not_found', { appId, kitPath })
      return { content: 'UI kit uploaded but files not found on disk. The upload may have failed.', role: 'user', insertionOrder: 'after_history' }
    }

    const sections: string[] = []
    sections.push('# UI Kit — Design System Reference')
    sections.push('')
    sections.push('The UI kit has been written to `docs/ui-kit/` on disk. This kit is your design language — the components and primitives below define the visual vocabulary for everything you build. Default to these building blocks for every UI need. When you need something not explicitly covered, compose or extend these pieces in a way that matches their style and tokens.')
    sections.push('')

    // Load full content for primitives and components
    const allFiles = collectFiles(kitPath, kitPath)
    for (const filePath of allFiles) {
      if (!(filePath.startsWith('primitives/') || filePath.startsWith('components/'))) continue
      if (!filePath.endsWith('.md') && !filePath.endsWith('.json')) continue
      try {
        const content = readFileSync(join(kitPath, filePath), 'utf-8')
        sections.push(`---`)
        sections.push(`## ${filePath}`)
        sections.push('')
        sections.push(content)
        sections.push('')
      } catch (err) {
        logger.warn('context.renderer.ui_kit_upload.file_read_failed', {
          filePath, error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // List layouts and showcase available on-demand
    const layouts = allFiles.filter(f => f.startsWith('layouts/'))
    const showcase = allFiles.filter(f => f.startsWith('showcase/'))

    if (layouts.length > 0 || showcase.length > 0) {
      sections.push('---')
      sections.push('## Additional References (on disk at docs/ui-kit/)')
      sections.push('')
      sections.push('Use `loadUiKit` tool with `include` param to load these in full:')
      sections.push('')
      if (layouts.length > 0) {
        sections.push('**Layouts:**')
        for (const f of layouts) sections.push(`- \`${f}\``)
        sections.push('')
      }
      if (showcase.length > 0) {
        sections.push('**Showcase:**')
        for (const f of showcase) sections.push(`- \`${f}\``)
        sections.push('')
      }
    }

    logger.info('context.renderer.ui_kit_upload.complete', { appId, fileCount: allFiles.length })

    return {
      content: sections.join('\n'),
      role: 'user',
      insertionOrder: 'after_history',
    }
  }

  shouldPersist(_attachment: ContextAttachment): boolean {
    return false
  }
}
