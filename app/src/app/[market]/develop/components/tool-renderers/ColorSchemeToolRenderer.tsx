'use client'

import { Palette } from 'lucide-react'

import ColorPaletteModal from '@/app/[market]/develop/components/tool-renderers/ColorPaletteModal'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import type { CompletePalette, PaletteData } from '@/app/[market]/develop/components/types/colorScheme'
import ColorPaletteGridWidget from '@/app/[market]/develop/components/widgets/ColorPaletteGridWidget'
import ColorPaletteWidget from '@/app/[market]/develop/components/widgets/ColorPaletteWidget'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useToolDetailsModal } from '@/stores/useToolDetailsModalStore'

export default function ColorSchemeToolRenderer(props: DefaultToolRendererProps) {
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  if (!isThemeSelectionChatEnabled) {
    return <ColorSchemeToolRendererLegacy {...props} />
  }
  return <ColorSchemeToolRendererModern {...props} />
}

/** @deprecated Remove when `airo-builder-theme-selection-chat` is permanently on */
function ColorSchemeToolRendererLegacy({
  toolStatus,
  toolId,
  input,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useToolDetailsModal(toolId)

  const mode = input?.mode as 'suggest' | 'apply' | 'set' | undefined
  const isSuggestMode = mode === 'suggest'
  const isAppliedMode = mode === 'apply' || mode === 'set'

  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, any>) : {}
  const widget = resultObj.widget as { widgetData?: { palettes?: unknown[] } } | undefined
  const palettes = resultObj.palettes || widget?.widgetData?.palettes || []
  const hasPalettes = Array.isArray(palettes) && palettes.length > 0

  const palette = resultObj.palette as (CompletePalette & { theme?: string }) | undefined
  const paletteName = (resultObj.paletteName as string | undefined) || input?.paletteName || 'Color Scheme'
  const hasPalette = palette && typeof palette === 'object'

  let displayName = t('builder_tools_css_color_scheme', undefined, 'Color Scheme')
  if (isSuggestMode) {
    displayName = t('builder_tools_css_suggest_scheme_suggest', undefined, 'Color Scheme Suggestions')
  } else if (isAppliedMode && paletteName) {
    const paletteTheme = (palette as unknown as { theme?: string })?.theme
    const themeLabel = paletteTheme === 'dark'
      ? t('builder_tools_css_color_dark', undefined, 'Dark')
      : t('builder_tools_css_color_light', undefined, 'Light')
    displayName = `${t('builder_tools_css_color_scheme', undefined, 'Color Scheme')}: ${paletteName} ${themeLabel}`
  }

  const hasDetails = (isSuggestMode && hasPalettes) || (isAppliedMode && hasPalette)

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

      {toolStatus === 'completed' && isSuggestMode && hasPalettes && (
        <div className="mt-2 mb-2">
          <ColorPaletteGridWidget palettes={palettes as PaletteData[]} />

          <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
            <span className="text-sm">{t('builder_tools_css_suggest_select_or_ask', undefined, 'Click a palette to preview or ask for more options')}</span>
          </div>
        </div>
      )}

      {toolStatus === 'completed' && isAppliedMode && hasPalette && (
        <div className="mt-2 mb-2">
          <ColorPaletteWidget
            name={paletteName as string}
            palette={palette as CompletePalette}
          />
        </div>
      )}

      <ColorPaletteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isSuggestMode ? t('builder_tools_css_suggest_title', undefined, 'Color Palette Options') : (paletteName as string)}
        palettes={isSuggestMode ? palettes : undefined}
        palette={isAppliedMode ? palette : undefined}
        showDetailsTab={isAppliedMode && !!fullMessage}
        detailsContent={fullMessage}
      />
    </div>
  )
}

function ColorSchemeToolRendererModern({
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const mode = input?.mode as 'suggest' | 'apply' | 'set' | undefined
  const isAppliedMode = mode === 'apply' || mode === 'set'

  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
  const palette = resultObj.palette as (CompletePalette & { theme?: string }) | undefined
  const paletteName = (resultObj.paletteName as string | undefined) || (input?.paletteName as string | undefined) || 'Color Scheme'
  const hasPalette = palette && typeof palette === 'object'

  // Render direct-apply results from both apply and set modes.
  if (toolStatus === 'completed' && isAppliedMode && hasPalette) {
    return (
      <div className="mt-2 mb-2">
        <ColorPaletteWidget
          name={paletteName as string}
          palette={palette as CompletePalette}
          readOnly
        />
      </div>
    )
  }

  return null
}
