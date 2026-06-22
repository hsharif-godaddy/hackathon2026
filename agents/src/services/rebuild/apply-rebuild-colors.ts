import { Logger } from '../../logging/index.js'
import { generatePalette, updateCssColors } from '../../tools/css-color-tool.js'
import { createForWorkspace } from '../../workspace/index.js'
import type { SiteMetadata, StylePreferences } from '../../types/rebuild.js'

const logger = Logger.create({ component: 'apply-rebuild-colors' })

/**
 * Deterministic color lever: when the user keeps colors, write the source
 * palette into globals.css before the agent runs, so colors hold regardless of
 * what the agent emits. Mirrors applyRebuildTypography.
 */
export async function applyRebuildColors(
  appId: string,
  metadata: SiteMetadata,
  prefs: StylePreferences,
  isFirstPage: boolean,
): Promise<{ applied: boolean }> {
  if (!isFirstPage) return { applied: false }
  if (prefs.colorPreference !== 'keep-original') return { applied: false }
  const primary = metadata.colorPalette?.primary?.[0]
  if (!primary) return { applied: false }

  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) {
    logger.warn('rebuild.colors.workspace_unavailable', { appId })
    return { applied: false }
  }

  try {
    const generated = generatePalette({
      primary,
      secondary: metadata.colorPalette.secondary?.[0],
      accent: metadata.colorPalette.accent?.[0],
    })
    await updateCssColors(workspace.files, generated)
  } catch (error) {
    logger.warn('rebuild.colors.failed', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { applied: false }
  }
  logger.info('rebuild.colors.applied', { appId, primary })
  return { applied: true }
}
