'use client'

import { MessageSquare, Type } from 'lucide-react'
import { useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import FontThemeGridWidget from '@/app/develop/components/widgets/FontThemeGridWidget'
import { useTranslations } from '@/hooks/useTranslations'

/**
 * Font Theme Tool Renderer
 *
 * Handles rendering for the fontTheme tool which has two modes:
 * - suggest: Shows multiple font theme options in a grid
 * - apply: Shows confirmation message
 */
export default function FontThemeToolRenderer({
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

  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, any>) : {}
  const widget = resultObj.widget as { widgetData?: { themes?: unknown[] } } | undefined
  const themes = resultObj.themes || widget?.widgetData?.themes || []
  const hasThemes = Array.isArray(themes) && themes.length > 0

  const themeName = String((resultObj.themeName as string | undefined) || input?.themeName || 'Font Theme')

  let displayName = t('builder_tools_font_theme', undefined, 'Font Theme')
  if (isApplyMode && themeName) {
    displayName = `${displayName}: ${themeName}`
  } else if (isSuggestMode) {
    displayName = `${displayName}: ${t('builder_tools_font_theme_options', undefined, 'Options')}`
  }

  // Never show details modal for font theme - keep it simple
  const hasDetails = false
  const fullMessage = typeof resultObj.message === 'string' ? resultObj.message : ''

  return (
    <div>
      <ToolHeader
        icon={<Type className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={hasDetails}
        onOpenModal={() => setIsModalOpen(true)}
      />

      {/* SUGGEST MODE: Display font theme grid when completed */}
      {toolStatus === 'completed' && isSuggestMode && hasThemes && (
        <div className="mt-2 mb-2">
          <FontThemeGridWidget themes={themes} />

          {/* Helper message */}
          <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
            <MessageSquare className="w-3 h-3" aria-hidden="true" />
            <span className="text-sm">{t('builder_tools_font_theme_select', undefined, 'Click a font to select, then Apply')}</span>
          </div>
        </div>
      )}

      {/* APPLY MODE: Show simple success message */}
      {toolStatus === 'completed' && isApplyMode && (
        <div className="mt-2 mb-2">
          <div className="rounded-lg border bg-intents-ux-success-backgroundColor p-3 shadow-sm">
            <p className="text-sm text-intents-ux-success-textColor">
              <strong>{t('builder_tools_font_theme_applied', undefined, '✓ Applied:')}</strong> {themeName}
            </p>
            <p className="text-xs text-intents-ux-textSubtle-textColor mt-1">
              {t('builder_tools_font_theme_applied_description', undefined, 'Font applied to all text (body and headings)')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

