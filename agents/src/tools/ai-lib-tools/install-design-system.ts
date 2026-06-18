import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { installDesignKitForApp } from '../../services/design-system/install.js'
import { logger } from '../../logging/index.js'

export const installDesignSystemAITool: Tool = createTool(
  'Download and install a design system from the catalog. Extracts to docs/ui-kit/ in the app workspace. After this returns, call loadUiKit to read the design system content and begin building.',
  z.object({
    slug: z.string().min(1).describe('The catalog id, slug, or displayName (case-insensitive), e.g. "Terra"'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
    if (!appId) return 'Error: App ID required'

    try {
      const result = await installDesignKitForApp(appId, input.slug)

      if ('error' in result) {
        if (result.error === 'workspace_unavailable') return `Error: workspace unavailable for app '${appId}'`
        return `Error: design system '${input.slug}' not found in catalog.`
      }

      return result.message
    } catch (err) {
      const phase = err instanceof Error && err.message.includes('catalog') ? 'catalog_fetch' : 'install'
      logger.warn('tool.install_design_system.failed', { slug: input.slug, phase, err: String(err) })
      return `Error installing design system (${phase}): ${err instanceof Error ? err.message : String(err)}`
    }
  }
)
