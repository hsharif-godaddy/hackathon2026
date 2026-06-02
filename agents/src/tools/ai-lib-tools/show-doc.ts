import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'show-doc-tool' })

/**
 * Validate a docs path. Mirrors the spec for showDoc type: 'doc':
 * - non-empty
 * - not absolute
 * - must start with `docs/`
 * - must end with `.md`
 * - must not contain `..` segments (no traversal)
 *
 * Returns null when valid, an error string otherwise.
 */
function validateDocPath(path: string): string | null {
  if (path.length === 0) {
    return 'path must not be empty'
  }
  if (path === 'design-preview') {
    return null
  }
  if (path.startsWith('/')) {
    return 'path must not be absolute (must not start with "/")'
  }
  if (!path.startsWith('docs/')) {
    return 'path must start with "docs/" (or be the literal "design-preview" keyword)'
  }
  if (!path.endsWith('.md')) {
    return 'path must end with ".md"'
  }
  if (path.includes('..')) {
    return 'path must not contain ".." (no traversal)'
  }
  return null
}

/**
 * Validate a page route path for type: 'page'.
 * Must start with '/' and not contain '..'.
 */
function validatePagePath(path: string): string | null {
  if (path.length === 0) {
    return 'path must not be empty'
  }
  if (!path.startsWith('/')) {
    return 'path must start with "/" (e.g. "/about", "/")'
  }
  if (path.includes('..')) {
    return 'path must not contain ".."'
  }
  return null
}

/**
 * Show Doc Tool
 *
 * Multi-mode tool for presenting results to the user:
 * - type: 'doc' — switch PreviewPane to docs-viewer and render a markdown file
 * - type: 'page' — switch to preview mode showing the built page
 * - type: 'ready' — signal build is complete, dismiss overlay, show preview
 */
export const showDocAITool: Tool = createTool(
  `Present a result to the user. Three modes:
- type "doc": Open a markdown file under docs/ in the docs panel (or "design-preview" keyword for live design preview). Use after writing docs.
- type "page": Switch to preview mode showing a specific page route. Use after building a page to show the result.
- type "ready": Signal that the build is complete and dismiss the loading overlay. Use as the final action after all builds are done.`,
  z.object({
    type: z.enum(['doc', 'page', 'ready']).default('doc').describe(
      '"doc" to show a markdown file, "page" to show a preview route, "ready" to signal build complete'
    ),
    path: z.string().optional().describe(
      'For doc: repo-relative path (e.g. "docs/design.md"). For page: route path (e.g. "/", "/about"). Not needed for ready.'
    ),
  }),
  async (input, context) => {
    const type: string = input.type ?? 'doc'
    const path: string | undefined = input.path
    const appId = context?.metadata?.appId as string | undefined

    if (type === 'doc') {
      if (!path) {
        throw new Error('path is required when type is "doc"')
      }
      const validationError = validateDocPath(path)
      if (validationError !== null) {
        logger.warn('showDoc.invalidPath', { appId, path, error: validationError })
        throw new Error(`Invalid docs path "${path}": ${validationError}`)
      }
      logger.info('showDoc.called', { appId, type, path })
      return { ok: true, type, path }
    }

    if (type === 'page') {
      if (!path) {
        throw new Error('path is required when type is "page"')
      }
      // Normalize absolute URLs to pathname-only
      let normalizedPath = path
      if (path.startsWith('http://') || path.startsWith('https://')) {
        try {
          const parsed = new URL(path)
          normalizedPath = parsed.pathname + (parsed.search ?? '')
        } catch {
          // Invalid URL, let validatePagePath handle it
        }
      }
      const validationError = validatePagePath(normalizedPath)
      if (validationError !== null) {
        logger.warn('showDoc.invalidPagePath', { appId, path, error: validationError })
        throw new Error(`Invalid page path "${path}": ${validationError}`)
      }
      logger.info('showDoc.called', { appId, type, path: normalizedPath })
      return { ok: true, type, path: normalizedPath }
    }

    // type === 'ready'
    logger.info('showDoc.called', { appId, type })
    return { ok: true, type }
  }
)
