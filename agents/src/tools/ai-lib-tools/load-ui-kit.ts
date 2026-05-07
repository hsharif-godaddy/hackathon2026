import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { logger } from '../../logging/index.js'

const appRepo = new AppRepository()

const AUTO_LOAD_DIRS = ['primitives', 'components']
const LIST_ONLY_DIRS = ['layouts', 'showcase']

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

export const loadUiKitAITool: Tool = createTool(
  'Load the UI kit design system from docs/ui-kit/. By default loads primitives and components in full, and lists layouts/landing-pages/showcase. Use the include parameter to load specific additional files.',
  z.object({
    include: z.array(z.string()).optional().describe('Additional file paths (relative to docs/ui-kit/) to load in full, e.g. ["layouts/recipe-editorial.md"]'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) return 'Error: App ID required'

    const app = appRepo.findById(appId)
    if (!app) return `Error: App '${appId}' not found`

    const kitPath = join(app.path, 'docs', 'ui-kit')
    if (!existsSync(kitPath)) {
      return 'No UI kit found. This app does not have a design system at docs/ui-kit/.'
    }

    const sections: string[] = []
    const hasIncludes = input.include && input.include.length > 0

    if (hasIncludes) {
      // Include mode: only load the requested files (primitives/components already in context)
      sections.push('# UI Kit — Requested References')
      sections.push('')
      for (const reqPath of input.include!) {
        const normalized = reqPath.replace(/\\/g, '/')
        if (normalized.includes('..') || normalized.startsWith('/')) {
          sections.push(`**${reqPath}**: Skipped (invalid path)`)
          continue
        }
        const fullPath = join(kitPath, normalized)
        if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
          sections.push(`**${reqPath}**: Not found`)
          continue
        }
        try {
          const content = readFileSync(fullPath, 'utf-8')
          sections.push(`---`)
          sections.push(`## ${reqPath}`)
          sections.push('')
          sections.push(content)
          sections.push('')
        } catch {
          sections.push(`**${reqPath}**: Failed to read`)
        }
      }
    } else {
      // Default mode: load primitives + components, list everything else
      sections.push('# UI Kit — Design System')
      sections.push('')

      for (const dir of AUTO_LOAD_DIRS) {
        const dirPath = join(kitPath, dir)
        if (!existsSync(dirPath)) continue
        const files = collectFiles(dirPath, kitPath)
        for (const filePath of files) {
          if (!filePath.endsWith('.md') && !filePath.endsWith('.json')) continue
          const fullPath = join(kitPath, filePath)
          try {
            const content = readFileSync(fullPath, 'utf-8')
            sections.push(`---`)
            sections.push(`## ${filePath}`)
            sections.push('')
            sections.push(content)
            sections.push('')
          } catch {
            logger.warn('tool.load_ui_kit.read_error', { path: filePath })
          }
        }
      }

      const available: string[] = []
      for (const dir of LIST_ONLY_DIRS) {
        const dirPath = join(kitPath, dir)
        if (!existsSync(dirPath)) continue
        const files = collectFiles(dirPath, kitPath)
        available.push(...files)
      }

      if (available.length > 0) {
        sections.push('---')
        sections.push('## Additional References')
        sections.push('')
        sections.push('Call `loadUiKit` with `include` to load specific files:')
        sections.push('')
        for (const f of available) {
          sections.push(`- \`${f}\``)
        }
        sections.push('')
      }
    }

    return sections.join('\n')
  }
)
