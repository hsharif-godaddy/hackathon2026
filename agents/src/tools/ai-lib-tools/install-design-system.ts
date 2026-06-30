import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { installDesignKitForApp } from '../../services/design-system/install.js'
import { applyKitDesignTokens, type ApplyKitDesignResult } from '../../services/design-system/apply-kit-design.js'
import { lockKitTokens } from '../../services/design-system/kit-tokens-locked.js'
import { logger } from '../../logging/index.js'

export const installDesignSystemAITool: Tool = createTool(
  'Download and install a design system from the catalog. Extracts to docs/ui-kit/ in the app workspace. After this returns, call loadUiKit to read the design system content and begin building.',
  z.object({
    slug: z.string().min(1).describe('The catalog id, slug, or displayName (case-insensitive), e.g. "Terra"'),
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string | undefined
    const customerId = context?.metadata?.customerId as string | undefined
    if (!appId) return 'Error: App ID required'

    try {
      const result = await installDesignKitForApp(appId, input.slug)

      if ('error' in result) {
        if (result.error === 'workspace_unavailable') return `Error: workspace unavailable for app '${appId}'`
        return `Error: design system '${input.slug}' not found in catalog.`
      }

      // AIROBUILD-2976: apply the kit's palette + fonts DETERMINISTICALLY IN CODE and
      // lock them, so an agent-installed (auto-select) kit is the source of truth. The
      // model otherwise re-derives its own palette from the business domain (producing
      // low-contrast text); this mirrors the forced-install / explicit-attach path. The
      // lock only gates the agent's colorScheme/fontTheme tools — customer edits via the
      // design-kit routes stay allowed. Best-effort: a failure here never blocks install.
      const applied: ApplyKitDesignResult = await applyKitDesignTokens({
        appId,
        design: result.design,
        displayName: result.displayName,
        customerId,
      })
      if (applied.appliedColors || applied.appliedFonts) {
        lockKitTokens(appId)
        const appliedParts: string = [applied.appliedColors && 'colors', applied.appliedFonts && 'fonts'].filter(Boolean).join(' and ')
        return `Installed "${result.displayName}" (${result.written} files in docs/ui-kit/). Its ${appliedParts} are ALREADY applied to the site and locked — do NOT call colorScheme or fontTheme to change them. Call loadUiKit to read its primitives, then build the pages using the kit's tokens.`
      }

      return result.message
    } catch (err) {
      const phase = err instanceof Error && err.message.includes('catalog') ? 'catalog_fetch' : 'install'
      logger.warn('tool.install_design_system.failed', { slug: input.slug, phase, err: String(err) })
      return `Error installing design system (${phase}): ${err instanceof Error ? err.message : String(err)}`
    }
  }
)
