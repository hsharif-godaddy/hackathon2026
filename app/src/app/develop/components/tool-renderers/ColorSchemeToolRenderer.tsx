'use client'

import { MessageSquare, Palette } from 'lucide-react'
import { useState } from 'react'

import ColorPaletteModal from '@/app/develop/components/tool-renderers/ColorPaletteModal'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ColorPaletteGridWidget from '@/app/develop/components/widgets/ColorPaletteGridWidget'
import ColorPaletteWidget, { type CompletePalette } from '@/app/develop/components/widgets/ColorPaletteWidget'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Color Scheme Tool Renderer
 *
 * Handles rendering for the unified colorScheme tool which has two modes:
 * - suggest: Shows multiple palette options in a grid (like old cssSuggest)
 * - apply: Shows the applied palette (like old cssColor)
 */
export default function ColorSchemeToolRenderer({
  toolName: _toolName,
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)

  const mode = input?.mode as 'suggest' | 'apply' | undefined
  const isSuggestMode = mode === 'suggest'
  const isApplyMode = mode === 'apply'

  // For suggest mode: extract palettes array
  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, any>) : {}
  const widget = resultObj.widget as { widgetData?: { palettes?: unknown[] } } | undefined
  const palettes = resultObj.palettes || widget?.widgetData?.palettes || []
  const hasPalettes = Array.isArray(palettes) && palettes.length > 0

  // For apply mode: extract single palette
  const palette = resultObj.palette as (CompletePalette & { theme?: string }) | undefined
  const paletteName = (resultObj.paletteName as string | undefined) || input?.paletteName || 'Color Scheme'
  const hasPalette = palette && typeof palette === 'object'

  // Determine display name based on mode
  let displayName = t('builder_tools_css_color_scheme', undefined, 'Color Scheme')
  if (isSuggestMode) {
    displayName = t('builder_tools_css_suggest_scheme_suggest', undefined, 'Color Scheme Suggestions')
  } else if (isApplyMode && paletteName) {
    const paletteTheme = (palette as unknown as { theme?: string })?.theme
    const themeLabel = paletteTheme === 'dark'
      ? t('builder_tools_css_color_dark', undefined, 'Dark')
      : t('builder_tools_css_color_light', undefined, 'Light')
    displayName = `${t('builder_tools_css_color_scheme', undefined, 'Color Scheme')}: ${paletteName} ${themeLabel}`
  }

  // Determine if we have details to show in modal
  const hasDetails = (isSuggestMode && hasPalettes) || (isApplyMode && hasPalette)

  // Get full message for details tab
  const fullMessage = typeof resultObj.message === 'string' ? resultObj.message : ''

  return (
    <div>
      <ToolHeader
        icon={<Palette className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {/* SUGGEST MODE: Display palette grid when completed */}
      {toolStatus === 'completed' && isSuggestMode && hasPalettes && (
        <div className="mt-2 mb-2">
          <ColorPaletteGridWidget palettes={palettes} />

          {/* Helper message */}
          <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
            <MessageSquare className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm">{t('builder_tools_css_suggest_select_or_ask', undefined, 'Click a palette to preview or ask for more options')}</span>
          </div>
        </div>
      )}

      {/* APPLY MODE: Display single palette widget when applied */}
      {toolStatus === 'completed' && isApplyMode && hasPalette && (
        <div className="mt-2 mb-2">
          <ColorPaletteWidget
            name={paletteName as string}
            palette={palette as CompletePalette}
          />
        </div>
      )}

      {/* Modal for detailed view */}
      <ColorPaletteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isSuggestMode ? t('builder_tools_css_suggest_title', undefined, 'Color Palette Options') : (paletteName as string)}
        palettes={isSuggestMode ? palettes : undefined}
        palette={isApplyMode ? palette : undefined}
        showDetailsTab={isApplyMode && !!fullMessage}
        detailsContent={fullMessage}
      />
    </div>
  )
}

