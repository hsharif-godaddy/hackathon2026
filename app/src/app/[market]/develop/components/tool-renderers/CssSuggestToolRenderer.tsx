'use client'

import { Palette } from 'lucide-react'
import { useState } from 'react'

import ColorPaletteModal from '@/app/[market]/develop/components/tool-renderers/ColorPaletteModal'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import type { PaletteData } from '@/app/[market]/develop/components/types/colorScheme'
import ColorPaletteGridWidget from '@/app/[market]/develop/components/widgets/ColorPaletteGridWidget'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Custom renderer for cssSuggest tool
 *
 * Displays a grid of color palette suggestions that were generated.
 * Shows the palettes inline without needing to expand details.
 * Clickable to open modal with tabs for each palette option.
 */
export default function CssSuggestToolRenderer(props: DefaultToolRendererProps) {
  const isThemeSelectionChatEnabled = useSwitchboard('airo-builder-theme-selection-chat')
  if (!isThemeSelectionChatEnabled) {
    return <CssSuggestToolRendererLegacy {...props} />
  }
  return <CssSuggestToolRendererModern {...props} />
}

/** @deprecated Remove when `airo-builder-theme-selection-chat` is permanently on */
function CssSuggestToolRendererLegacy({
  toolStatus,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)

  let palettes: PaletteData[] = []
  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const resultObj = result as any

    if (resultObj.widget?.widgetData?.palettes && Array.isArray(resultObj.widget.widgetData.palettes)) {
      palettes = resultObj.widget.widgetData.palettes
    } else if (resultObj.palettes && Array.isArray(resultObj.palettes)) {
      palettes = resultObj.palettes
    }
  }

  const hasPalettes = palettes.length > 0

  const displayName = (toolStatus === 'completed' && hasPalettes)
    ? `${t('builder_tools_css_suggest_scheme_suggest')} (${palettes.length} options)`
    : t('builder_tools_css_suggest_scheme_suggest')

  return (
    <div>
      <ToolHeader
        icon={<Palette className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasPalettes}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {toolStatus === 'completed' && hasPalettes && (
        <div className="mt-2 mb-2">
          <ColorPaletteGridWidget palettes={palettes} />

          <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
            <span className="text-sm">{t('builder_tools_css_suggest_select_or_ask')}</span>
          </div>
        </div>
      )}

      <ColorPaletteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('builder_tools_css_suggest_title')}
        palettes={palettes}
      />
    </div>
  )
}

function CssSuggestToolRendererModern({
  toolStatus,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Extract palettes from result
  let palettes: PaletteData[] = []
  if (toolStatus === 'completed' && result && typeof result === 'object') {
    const resultObj = result as any

    // Check for widget.widgetData.palettes structure
    if (resultObj.widget?.widgetData?.palettes && Array.isArray(resultObj.widget.widgetData.palettes)) {
      palettes = resultObj.widget.widgetData.palettes
    }
    // Fallback to direct palettes array
    else if (resultObj.palettes && Array.isArray(resultObj.palettes)) {
      palettes = resultObj.palettes
    }
  }

  const hasPalettes = palettes.length > 0

  const displayName = (toolStatus === 'completed' && hasPalettes)
    ? `${t('builder_tools_css_suggest_scheme_suggest')} (${palettes.length} options)`
    : t('builder_tools_css_suggest_scheme_suggest')

  return (
    <div>
      <ToolHeader
        icon={<Palette className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasPalettes}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {/* Display palette grid when completed */}
      {toolStatus === 'completed' && hasPalettes && (
        <div className="mt-2 mb-2">
          <ColorPaletteGridWidget palettes={palettes} />

          {/* Helper message */}
          <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
            <span className="text-sm">{t('builder_tools_css_suggest_select_or_ask')}</span>
          </div>
        </div>
      )}

      <ColorPaletteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('builder_tools_css_suggest_title')}
        palettes={palettes}
      />
    </div>
  )
}
