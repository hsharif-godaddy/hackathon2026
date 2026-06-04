import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { fetchDesignSystemCatalog, resolveDesignSystemBaseUrl } from '../../services/design-system/catalog.js'
import { installDesignSystem } from '../../services/design-system/install.js'
import { logger } from '../../logging/index.js'
import { createForWorkspace } from '../../workspace/index.js'

export const installDesignSystemAITool: Tool = createTool(
  'Download and install a design system by slug. Extracts to docs/ui-kit/ in the app workspace. After this returns, call loadUiKit to read the design system content and begin building.',
  z.object({
    slug: z.string().min(1).describe('The catalog slug, e.g. "modern-bento"'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
    if (!appId) return 'Error: App ID required'

    try {
      const workspace = createForWorkspace(appId, 'preview')
      if (!workspace) return `Error: workspace unavailable for app '${appId}'`

      const catalog = await fetchDesignSystemCatalog()
      const entry = catalog.kits.find(k => k.slug === input.slug)
      if (!entry) return `Error: design system '${input.slug}' not found in catalog.`

      const result = await installDesignSystem({
        workspace,
        entry,
        baseUrl: resolveDesignSystemBaseUrl(),
      })

      return `Installed design system \`${result.slug}\` (${result.written} files extracted to docs/ui-kit/). Call \`loadUiKit\` next to read the design system primitives and components.`
    } catch (err) {
      const phase = err instanceof Error && err.message.includes('catalog') ? 'catalog_fetch' : 'install'
      logger.warn('tool.install_design_system.failed', { slug: input.slug, phase, err: String(err) })
      return `Error installing design system (${phase}): ${err instanceof Error ? err.message : String(err)}`
    }
  }
)
