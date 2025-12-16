'use client'

import { Palette } from 'lucide-react'
import { useState } from 'react'

import ColorPaletteModal from '@/app/develop/components/tool-renderers/ColorPaletteModal'
import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import ColorPaletteGridWidget, { type PaletteData } from '@/app/develop/components/widgets/ColorPaletteGridWidget'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Custom renderer for cssSuggest tool
 *
 * Displays a grid of color palette suggestions that were generated.
 * Shows the palettes inline without needing to expand details.
 * Clickable to open modal with tabs for each palette option.
 */
export default function CssSuggestToolRenderer({
  toolName: _toolName,
  toolStatus,
  result
}: DefaultToolRendererProps) {
  const t = useTranslations();
  const [isVisible] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (!isVisible) {
    return null
  }

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
            <svg
              className="w-3 h-3"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.54.36 3 .97 4.29L2 22l5.71-.97C9 21.64 10.46 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18c-1.38 0-2.68-.3-3.86-.83l-.28-.14-2.86.49.49-2.86-.14-.28A7.95 7.95 0 014 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8z"/>
              <path d="M7 9h10v2H7zm0 4h7v2H7z"/>
            </svg>
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
