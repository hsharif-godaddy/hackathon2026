import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { AppRepository } from '../../database/repositories/AppRepository.js'
import { getKvMemoryStore } from '../../memory/adapters/index.js'
import { customerIdFromContext, workspaceScopeFromAppId } from '../../memory/interfaces/scope.js'
import { FileEditTool } from '../file-edit.js'
import { Logger } from '../../logging/index.js'

const logger = Logger.create({ component: 'set-project-name-tool' })

/**
 * Escape characters that are unsafe to splice into JSX text content.
 * Includes the standard HTML entities plus `{` / `}`, which open JSX
 * expression slots and would turn a name like `My {App}` into a compile
 * error when written into RootLayout.tsx. JSX parsers decode these
 * numeric entities back into literal characters at render time.
 */
function escapeJsxText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
}

/**
 * Set Project Name Tool for AI-Lib
 * Allows the initial agent to set the project name after gathering information
 */
export const setProjectNameAITool: Tool = createTool(
  'Set the project name after gathering necessary information from the user.',
  z.object({
    name: z.string().min(1).max(100).describe('The project name to set (1-100 characters)')
  }),
  async (input, context) => {
    try {
      const appId = context?.metadata?.appId as string | undefined

      if (!appId) {
        throw new Error('No app ID available in context')
      }

      const appRepo = new AppRepository()
      const existingApp = appRepo.findById(appId)

      if (!existingApp) {
        throw new Error(`App not found: ${appId}`)
      }

      // Update the app name
      const updatedApp = appRepo.update(appId, { name: input.name })

      if (!updatedApp) {
        throw new Error('Failed to update app name')
      }

      // Also store in brand.identity memory so the brand-data route picks it up.
      // Wrapped in its own try/catch so a memory infrastructure failure (e.g.
      // store initialization throw from a locked DB) cannot mask the
      // already-committed appRepo.update().
      let memorySyncFailed = false
      try {
        const memoryStore = getKvMemoryStore()
        const scope = workspaceScopeFromAppId(appId, customerIdFromContext(context))
        const existing = await memoryStore.get(scope, 'brand.identity')
        if (!existing.success) {
          // Skip write when read fails — writing { brandName } over an unknown
          // base would destroy any existing personality/voice/tagline fields.
          memorySyncFailed = true
          logger.warn('setProjectName.memoryRead.failed', {
            appId,
            error: existing.error ?? 'Unknown error',
          })
        } else {
          const current = (existing.exists && typeof existing.value === 'object' && existing.value !== null)
            ? existing.value as Record<string, unknown>
            : {}
          const memResult = await memoryStore.set(scope, 'brand.identity', { ...current, brandName: input.name })
          if (!memResult.success) {
            memorySyncFailed = true
            logger.warn('setProjectName.memoryWrite.failed', {
              appId,
              error: memResult.error ?? 'Unknown error',
            })
          }
        }
      } catch (memErr) {
        memorySyncFailed = true
        logger.warn('setProjectName.memorySync.error', {
          appId,
          error: memErr instanceof Error ? memErr.message : String(memErr),
        })
      }

      logger.info('setProjectName.success', {
        appId,
        oldName: existingApp.name,
        newName: input.name
      })

      // Update the default <title> in RootLayout.tsx if it still has the default value.
      // Site-wide head management lives in a <Helmet> in src/layouts/RootLayout.tsx
      // (see app-templates/v8); index.html has no <title> tag under SSR.
      if (existingApp.path) {
        try {
          const defaultTitle = '<title>App Template</title>'
          // Escape for JSX text content (HTML entities + JSX `{`/`}` delimiters)
          const safeTitle = escapeJsxText(input.name)
          const newTitle = `<title>${safeTitle}</title>`

          const fileEditTool = new FileEditTool()
          const result = await fileEditTool.editFile(existingApp.path, {
            path: 'src/layouts/RootLayout.tsx',
            mode: 'edit',
            edits: [{ old: defaultTitle, new: newTitle }],
            autoCommit: true,
            commitMessage: `Set page title to "${input.name}"`
          }, { appId })

          if (result.success) {
            logger.info('setProjectName.titleUpdated', { appId, title: input.name })
          } else if (
            result.error?.includes('Search text not found') ||
            result.error?.includes('No changes were applied')
          ) {
            // Title was already customized - the default title string wasn't found
            logger.info('setProjectName.titleSkipped', { appId, reason: 'already-customized' })
          } else {
            logger.warn('setProjectName.titleUpdateFailed', {
              appId,
              error: result.error || 'Unknown error',
            })
          }
        } catch (err) {
          logger.warn('setProjectName.titleUpdateFailed', {
            appId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const base = `**Project Name Set**\n\nProject name updated to: **${input.name}**`
      if (memorySyncFailed) {
        return `${base}\n\n> Note: Brand identity memory sync failed — the name was saved but may not appear in the Brand Book immediately.`
      }
      return base
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      
      logger.error('setProjectName.failed', {
        appId: context?.metadata?.appId,
        error: errorMessage,
      })

      return `**Error Setting Project Name**\n\n${errorMessage}`
    }
  }
)

