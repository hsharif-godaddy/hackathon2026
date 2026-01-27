'use client'

import { MessageSquare, Type } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/develop/components/tool-renderers/DefaultToolRenderer'
import FontThemeModal from '@/app/develop/components/tool-renderers/FontThemeModal'
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

  const _themeName = String((resultObj.themeName as string | undefined) || input?.themeName || 'Font Theme')

  // Extract font information for preview
  const appliedFont = resultObj.appliedFont as { name?: string; fontName?: string; weights?: string[] } | undefined
  const fontName = appliedFont?.fontName || resultObj.fontName as string | undefined
  const fontWeights = appliedFont?.weights || ['400', '700'] // Default weights if not provided

  // Computed styles to reduce duplication
  const fontFamily = fontName ? `"${fontName}", -apple-system, BlinkMacSystemFont, sans-serif` : undefined

  // Load Google Font when font is applied (named function for React DevTools profiling)
  useEffect(function loadGoogleFont() {
    if (!fontName || !toolStatus || toolStatus !== 'completed') return

    const linkId = 'font-theme-renderer-font'
    let link = document.getElementById(linkId) as HTMLLinkElement

    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }

    // Google Fonts API expects spaces as '+' and other special chars URL-encoded
    const encodedFontFamily = encodeURIComponent(fontName).replace(/%20/g, '+')
    const weights = Array.isArray(fontWeights) ? fontWeights.join(';') : '400;700'
    const fontUrl = `https://fonts.googleapis.com/css2?family=${encodedFontFamily}:wght@${weights}&display=swap`

    if (link.href !== fontUrl) {
      link.href = fontUrl
    }
  }, [fontName, fontWeights, toolStatus])

  // For suggest mode, show header with options label
  const displayName = isSuggestMode
    ? `${t('builder_tools_font_theme', undefined, 'Font Theme')}: ${t('builder_tools_font_theme_options', undefined, 'Options')}`
    : t('builder_tools_font_theme', undefined, 'Font Theme')

  // Show header only for suggest mode or while loading
  const showHeader = isSuggestMode || toolStatus !== 'completed'

  return (
    <div>
      {showHeader && (
        <ToolHeader
          icon={<Type className="w-2 h-2" />}
          displayName={displayName}
          toolStatus={toolStatus}
          hasDetails={false}
        />
      )}

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

      {/* APPLY MODE: Show card with font preview matching ColorPaletteWidget style */}
      {toolStatus === 'completed' && isApplyMode && fontName && (
        <div className="mt-2 mb-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="w-full rounded-md border-2 border-border bg-intents-ux-success-backgroundColor p-2 transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor text-left"
          >
            <div className="flex flex-row gap-1 justify-between items-center w-full">
              <div className="flex flex-col items-start">
                <span
                  className="text-base font-semibold leading-none text-intents-ux-success-textColor"
                  style={{ fontFamily }}
                >
                  {fontName}
                </span>
                <span
                  className="text-xs font-thin leading-none text-intents-ux-textSubtle-textColor mt-1"
                  style={{ fontFamily }}
                >
                  The quick brown fox jumps over the lazy dog
                </span>
              </div>
              <div
                className="size-6 rounded-sm flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: '#1a1a1a' }}
                aria-hidden="true"
              >
                <span
                  className="text-sm font-bold"
                  style={{ fontFamily, color: '#ffffff' }}
                >
                  Aa
                </span>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* DIRECT SET MODE: Show card with font preview matching ColorPaletteWidget style */}
      {toolStatus === 'completed' && !isSuggestMode && !isApplyMode && fontName && (
        <div className="mt-2 mb-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="w-full rounded-md border-2 border-border bg-intents-ux-boxLowContrast-backgroundColor p-2 transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor text-left"
          >
            <div className="flex flex-row gap-1 justify-between items-center w-full">
              <div className="flex flex-col items-start">
                <span
                  className="text-base font-semibold leading-none text-intents-ux-text-textColor"
                  style={{ fontFamily }}
                >
                  {fontName}
                </span>
                <span
                  className="text-xs font-thin leading-none text-intents-ux-textSubtle-textColor mt-1"
                  style={{ fontFamily }}
                >
                  The quick brown fox jumps over the lazy dog
                </span>
              </div>
              <div
                className="size-6 rounded-sm flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: '#1a1a1a' }}
                aria-hidden="true"
              >
                <span
                  className="text-sm font-bold"
                  style={{ fontFamily, color: '#ffffff' }}
                >
                  Aa
                </span>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Modal for detailed font view */}
      {fontName && (
        <FontThemeModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          fontName={fontName}
        />
      )}
    </div>
  )
}

