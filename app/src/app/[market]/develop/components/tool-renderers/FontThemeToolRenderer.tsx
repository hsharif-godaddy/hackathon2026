'use client'

import { Type } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import FontThemeModal from '@/app/[market]/develop/components/tool-renderers/FontThemeModal'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
import FontPaletteWidget from '@/app/[market]/develop/components/widgets/FontPaletteWidget'
import FontThemeGridWidget from '@/app/[market]/develop/components/widgets/FontThemeGridWidget'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'

/** @deprecated Remove when `airo-builder-font-selection-chat` is permanently on */
function FontThemeToolRendererLegacy({
  toolName: _toolName,
  toolStatus,
  input,
  result,
  error
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false)

  const mode = input?.mode as 'suggest' | 'apply' | undefined
  const isSuggestMode = mode === 'suggest'
  const isApplyMode = mode === 'apply'

  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}
  const widget = resultObj.widget as { widgetData?: { themes?: unknown[] } } | undefined
  const themes = resultObj.themes || widget?.widgetData?.themes || []
  const hasThemes = Array.isArray(themes) && themes.length > 0

  // Extract font information for preview - supports new headerFont/bodyFont and legacy fontName
  const appliedFont = resultObj.appliedFont as {
    name?: string
    fontName?: string
    weights?: string[]
    headerFont?: { name: string; weights: string[]; category: string }
    bodyFont?: { name: string; weights: string[]; category: string }
  } | undefined

  // Support new headerFont/bodyFont structure or fall back to legacy fontName
  const headerFont = useMemo(
    () =>
      appliedFont?.headerFont ||
      (appliedFont?.fontName
        ? {
            name: appliedFont.fontName,
            weights: appliedFont.weights || ['400', '700'],
            category: 'sans-serif'
          }
        : undefined) ||
      (resultObj.headerFont as { name: string; weights: string[] } | undefined),
    [appliedFont?.headerFont, appliedFont?.fontName, appliedFont?.weights, resultObj.headerFont]
  )

  const bodyFont = useMemo(
    () =>
      appliedFont?.bodyFont ||
      (appliedFont?.fontName
        ? {
            name: appliedFont.fontName,
            weights: appliedFont.weights || ['400', '700'],
            category: 'sans-serif'
          }
        : undefined) ||
      (resultObj.bodyFont as { name: string; weights: string[] } | undefined),
    [appliedFont?.bodyFont, appliedFont?.fontName, appliedFont?.weights, resultObj.bodyFont]
  )

  // Legacy fallback for fontName
  const legacyFontName = resultObj.fontName as string | undefined
  const headerFontName = headerFont?.name || legacyFontName
  const bodyFontName = bodyFont?.name || legacyFontName

  // Display label for the font pairing
  const fontDisplayLabel = headerFontName && bodyFontName
    ? (headerFontName === bodyFontName ? headerFontName : `${headerFontName} + ${bodyFontName}`)
    : headerFontName || bodyFontName

  // Computed styles
  const headerFontFamily = headerFontName ? `"${headerFontName}", -apple-system, BlinkMacSystemFont, sans-serif` : undefined
  const bodyFontFamily = bodyFontName ? `"${bodyFontName}", -apple-system, BlinkMacSystemFont, sans-serif` : undefined

  // Load Google Fonts when fonts are applied (named function for React DevTools profiling)
  useEffect(function loadGoogleFonts() {
    if ((!headerFontName && !bodyFontName) || !toolStatus || toolStatus !== 'completed') return

    const linkId = 'font-theme-renderer-font'
    let link = document.getElementById(linkId) as HTMLLinkElement

    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }

    // Build font families - deduplicate if same font
    const fontMap = new Map<string, Set<string>>()

    if (headerFont?.name) {
      const existing = fontMap.get(headerFont.name) || new Set<string>()
      headerFont.weights.forEach((w: string) => existing.add(w))
      fontMap.set(headerFont.name, existing)
    }

    if (bodyFont?.name) {
      const existing = fontMap.get(bodyFont.name) || new Set<string>()
      bodyFont.weights.forEach((w: string) => existing.add(w))
      fontMap.set(bodyFont.name, existing)
    }

    const fontFamilies: string[] = []
    fontMap.forEach((weights, name) => {
      const encodedName = encodeURIComponent(name).replace(/%20/g, '+')
      const weightsStr = Array.from(weights).sort().join(';')
      fontFamilies.push(`${encodedName}:wght@${weightsStr}`)
    })

    if (fontFamilies.length === 0) return

    const fontUrl = `https://fonts.googleapis.com/css2?family=${fontFamilies.join('&family=')}&display=swap`

    if (link.href !== fontUrl) {
      link.href = fontUrl
    }
  }, [headerFont, bodyFont, headerFontName, bodyFontName, toolStatus])

  // For suggest mode, show header with options label
  const displayName = isSuggestMode
    ? `${t('builder_tools_font_theme', undefined, 'Font Theme')}: ${t('builder_tools_font_theme_options', undefined, 'Options')}`
    : t('builder_tools_font_theme', undefined, 'Font Theme')

  return (
    <div>
      <ToolHeader
        icon={<Type className="w-2 h-2" />}
        displayName={displayName}
        toolStatus={toolStatus}
        hasDetails={toolStatus === 'error' && !!error}
        onOpenModal={toolStatus === 'error' && error ? () => setIsErrorModalOpen(true) : undefined}
      />

      {/* Error details modal */}
      {toolStatus === 'error' && error && (
        <ToolModal
          isOpen={isErrorModalOpen}
          onClose={() => setIsErrorModalOpen(false)}
          title={t('builder_tools_font_theme', undefined, 'Font Theme')}
        >
          <div className="flex-1 overflow-y-auto space-y-2">
            {input && Object.keys(input).length > 0 && (
              <div>
                <div className="text-sm font-bold mb-1">{t('builder_tools_default_arguments', undefined, 'Arguments')}</div>
                <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-1.5 rounded border border-border max-h-32 overflow-y-auto">
                  {JSON.stringify(input, null, 2)}
                </pre>
              </div>
            )}
            <div>
              <div className="text-sm font-bold mb-1 text-destructive">{t('builder_status_error', undefined, 'Error')}</div>
              <div className="bg-destructive/10 border border-destructive/30 p-1.5 rounded">
                <pre className="text-xs whitespace-pre-wrap font-mono text-destructive-foreground">
                  {error}
                </pre>
              </div>
            </div>
          </div>
        </ToolModal>
      )}

      {/* SUGGEST MODE: Display font theme grid when completed */}
      {toolStatus === 'completed' && isSuggestMode && hasThemes && (
        <div className="mt-2 mb-2">
          <FontThemeGridWidget themes={themes} />

          {/* Helper message */}
          <div className="flex items-center gap-1 text-xs text-intents-ux-textSubtle-textColor mt-2">
            <span className="text-sm">{t('builder_tools_font_theme_select', undefined, 'Click a font to select, then Apply')}</span>
          </div>
        </div>
      )}

      {/* APPLY MODE: Show read-only card with font preview */}
      {toolStatus === 'completed' && isApplyMode && (headerFontName || bodyFontName) && (
        <div className="mt-2 mb-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="w-full rounded-md border-2 border-border bg-intents-ux-box-backgroundColor p-2 transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor text-left"
          >
            <div className="flex flex-row gap-1 justify-between items-center w-full">
              <div className="flex flex-col items-start">
                <span
                  className="text-base font-semibold leading-none text-intents-ux-success-textColor"
                  style={{ fontFamily: headerFontFamily }}
                >
                  {fontDisplayLabel}
                </span>
                <span
                  className="text-xs font-thin leading-none text-intents-ux-textSubtle-textColor mt-1"
                  style={{ fontFamily: bodyFontFamily }}
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
                  style={{ fontFamily: headerFontFamily, color: '#ffffff' }}
                >
                  Aa
                </span>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* DIRECT SET MODE: Show card with font preview matching ColorPaletteWidget style */}
      {toolStatus === 'completed' && !isSuggestMode && !isApplyMode && (headerFontName || bodyFontName) && (
        <div className="mt-2 mb-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="w-full rounded-md border-2 border-border bg-intents-ux-box-backgroundColor p-2 transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor text-left"
          >
            <div className="flex flex-row gap-1 justify-between items-center w-full">
              <div className="flex flex-col items-start">
                <span
                  className="text-base font-semibold leading-none text-intents-ux-text-textColor"
                  style={{ fontFamily: headerFontFamily }}
                >
                  {fontDisplayLabel}
                </span>
                <span
                  className="text-xs font-thin leading-none text-intents-ux-textSubtle-textColor mt-1"
                  style={{ fontFamily: bodyFontFamily }}
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
                  style={{ fontFamily: headerFontFamily, color: '#ffffff' }}
                >
                  Aa
                </span>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Modal for detailed font view */}
      {(headerFontName || bodyFontName) && (
        <FontThemeModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          headerFontName={headerFontName}
          bodyFontName={bodyFontName}
        />
      )}
    </div>
  )
}

function FontThemeToolRendererModern({
  toolStatus,
  input,
  result
}: DefaultToolRendererProps) {
  const mode = input?.mode as 'suggest' | 'apply' | 'set' | undefined
  const isApplyMode = mode === 'apply' || mode === 'set'

  const resultObj = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {}

  // Extract font information for preview - supports new headerFont/bodyFont and legacy fontName
  const appliedFont = resultObj.appliedFont as {
    name?: string
    fontName?: string
    weights?: string[]
    headerFont?: { name: string; weights: string[]; category: string }
    bodyFont?: { name: string; weights: string[]; category: string }
  } | undefined

  // Theme name
  const themeName = (resultObj.themeName as string | undefined) || appliedFont?.name || 'Font Theme'

  // Support new headerFont/bodyFont structure or fall back to legacy fontName
  const headerFont = appliedFont?.headerFont ||
    (appliedFont?.fontName
      ? {
          name: appliedFont.fontName,
          weights: appliedFont.weights || ['400', '700'],
          category: 'sans-serif'
        }
      : undefined) ||
    (resultObj.headerFont as { name: string; weights: string[] } | undefined)

  const bodyFont = appliedFont?.bodyFont ||
    (appliedFont?.fontName
      ? {
          name: appliedFont.fontName,
          weights: appliedFont.weights || ['400', '700'],
          category: 'sans-serif'
        }
      : undefined) ||
    (resultObj.bodyFont as { name: string; weights: string[] } | undefined)

  // Extract font names - handle both object format (set mode) and string format (apply mode)
  const headerFontFromResult = resultObj.headerFont
  const bodyFontFromResult = resultObj.bodyFont
  const legacyFontName = resultObj.fontName as string | undefined

  const headerFontName = headerFont?.name ||
    (typeof headerFontFromResult === 'string' ? headerFontFromResult : undefined) ||
    legacyFontName

  const bodyFontName = bodyFont?.name ||
    (typeof bodyFontFromResult === 'string' ? bodyFontFromResult : undefined) ||
    legacyFontName

  // Load Google Fonts when fonts are applied
  useEffect(function loadGoogleFonts() {
    if ((!headerFontName && !bodyFontName) || !toolStatus || toolStatus !== 'completed') return

    const linkId = 'font-theme-renderer-modern-font'
    let link = document.getElementById(linkId) as HTMLLinkElement

    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }

    // Build font families with default weights
    const fontMap = new Map<string, Set<string>>()

    if (headerFontName) {
      const existing = fontMap.get(headerFontName) || new Set<string>()
      // Use weights from font info if available, otherwise default
      const weights = headerFont?.weights || ['400', '600', '700']
      weights.forEach((w: string) => existing.add(w))
      fontMap.set(headerFontName, existing)
    }

    if (bodyFontName) {
      const existing = fontMap.get(bodyFontName) || new Set<string>()
      // Use weights from font info if available, otherwise default
      const weights = bodyFont?.weights || ['400', '500', '600']
      weights.forEach((w: string) => existing.add(w))
      fontMap.set(bodyFontName, existing)
    }

    const fontFamilies: string[] = []
    fontMap.forEach((weights, name) => {
      const encodedName = encodeURIComponent(name).replace(/%20/g, '+')
      const weightsStr = Array.from(weights).sort().join(';')
      fontFamilies.push(`${encodedName}:wght@${weightsStr}`)
    })

    if (fontFamilies.length === 0) return

    const fontUrl = `https://fonts.googleapis.com/css2?family=${fontFamilies.join('&family=')}&display=swap`

    if (link.href !== fontUrl) {
      link.href = fontUrl
    }
  }, [headerFont, bodyFont, headerFontName, bodyFontName, toolStatus])

  // Render direct-apply results from apply mode
  if (toolStatus === 'completed' && isApplyMode && headerFontName && bodyFontName) {
    // Normalize fonts to ensure weights array exists
    const normalizedHeaderFont = (headerFont && headerFont.weights) ? headerFont : {
      name: headerFontName,
      weights: ['400', '600', '700'],
    }
    const normalizedBodyFont = (bodyFont && bodyFont.weights) ? bodyFont : {
      name: bodyFontName,
      weights: ['400', '500', '600'],
    }

    return (
      <div className="mt-2 mb-2">
        <FontPaletteWidget
          name={themeName}
          headerFont={normalizedHeaderFont}
          bodyFont={normalizedBodyFont}
        />
      </div>
    )
  }

  return null
}

/**
 * Font Theme Tool Renderer
 *
 * Handles rendering for the fontTheme tool which has two modes:
 * - suggest: Shows multiple font theme options in a grid
 * - apply: Shows confirmation message
 */
export default function FontThemeToolRenderer(props: DefaultToolRendererProps) {
  const isFontSelectionChatEnabled = useSwitchboard('airo-builder-font-selection-chat')
  if (!isFontSelectionChatEnabled) {
    return <FontThemeToolRendererLegacy {...props} />
  }
  return <FontThemeToolRendererModern {...props} />
}
