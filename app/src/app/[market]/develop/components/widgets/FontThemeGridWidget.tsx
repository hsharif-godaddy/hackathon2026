'use client';

import { useEffect, useState } from 'react';
import Button from '@ux/button';

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext';
import { useTranslations } from '@/hooks/useTranslations';
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';

interface FontInfo {
  name: string
  weights: string[]
  category: string
}

interface FontTheme {
  id: string
  name: string
  description: string
  headerFont?: FontInfo
  bodyFont?: FontInfo
  font?: FontInfo  // Legacy field for backwards compatibility
}

/**
 * Normalize a FontTheme to always have headerFont and bodyFont.
 * Handles backwards compatibility with legacy single-font themes.
 */
function normalizeFontTheme(theme: FontTheme): { headerFont: FontInfo; bodyFont: FontInfo } {
  if (theme.headerFont && theme.bodyFont) {
    return { headerFont: theme.headerFont, bodyFont: theme.bodyFont }
  }
  // Legacy fallback: use single font for both
  if (!theme.font) {
    throw new Error('FontTheme must have either headerFont/bodyFont or font field')
  }
  return { headerFont: theme.font, bodyFont: theme.font }
}

export interface FontThemeGridWidgetProps {
  themes: FontTheme[]
  className?: string
  onApply?: (themeId: string) => void
}

export default function FontThemeGridWidget({ themes, className = '' }: FontThemeGridWidgetProps) {
  const [loadedThemes, setLoadedThemes] = useState<Set<string>>(new Set())
  const [selectedTheme, setSelectedTheme] = useState<FontTheme | null>(null)
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading

  const safeThemes = Array.isArray(themes) ? themes : []
  const hasThemes = safeThemes.length > 0

  useEffect(function loadGoogleFonts() {
    if (!hasThemes) return

    const fontMap = new Map<string, Set<string>>()

    safeThemes.forEach(theme => {
      const { headerFont, bodyFont } = normalizeFontTheme(theme)

      // Add header font
      if (headerFont?.name) {
        const existing = fontMap.get(headerFont.name) || new Set<string>()
        headerFont.weights.forEach(w => existing.add(w))
        fontMap.set(headerFont.name, existing)
      }

      // Add body font
      if (bodyFont?.name) {
        const existing = fontMap.get(bodyFont.name) || new Set<string>()
        bodyFont.weights.forEach(w => existing.add(w))
        fontMap.set(bodyFont.name, existing)
      }
    })

    const newFontFamilies: string[] = []
    fontMap.forEach((weights, name) => {
      const fontName = name.replace(/\s+/g, '+')
      const weightsStr = Array.from(weights).sort().join(';')
      newFontFamilies.push(`${fontName}:wght@${weightsStr}`)
    })

    if (newFontFamilies.length === 0) return

    const linkId = 'font-theme-widget-fonts'

    let link = document.getElementById(linkId) as HTMLLinkElement
    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }

    // Parse existing fonts from current link to preserve them
    const existingFonts = new Set<string>()
    if (link.href) {
      try {
        const url = new URL(link.href)
        const families = url.searchParams.getAll('family')
        families.forEach(f => existingFonts.add(f))
      } catch {
        // Invalid URL, ignore
      }
    }

    // Add new fonts to the set (deduplicates automatically)
    newFontFamilies.forEach(f => existingFonts.add(f))

    // Limit total fonts to prevent performance issues and URL length limits
    // Keep most recently added fonts (FIFO queue behavior)
    const MAX_FONTS = 24 // 6 requests × 4 fonts each, reasonable for UX
    let allFontFamilies = Array.from(existingFonts)
    if (allFontFamilies.length > MAX_FONTS) {
      // Keep newest fonts (assumes newFontFamilies are at the end)
      // This ensures current widget's fonts are always loaded
      const newFontsSet = new Set(newFontFamilies)
      const oldFonts = allFontFamilies.filter(f => !newFontsSet.has(f))
      const toRemove = allFontFamilies.length - MAX_FONTS
      // Remove oldest fonts
      const keptOldFonts = oldFonts.slice(toRemove)
      allFontFamilies = [...keptOldFonts, ...newFontFamilies]
    }

    const fontFamiliesStr = allFontFamilies.join('&family=')
    const newHref = `https://fonts.googleapis.com/css2?family=${fontFamiliesStr}&display=swap`

    // Check URL length to prevent issues (Google Fonts and browser limits)
    if (newHref.length > 2000) {
      // URL too long, use only new fonts
      const fallbackStr = newFontFamilies.join('&family=')
      link.href = `https://fonts.googleapis.com/css2?family=${fallbackStr}&display=swap`
    } else if (link.href !== newHref) {
      link.href = newHref

      link.onload = function markFontsLoaded() {
        setLoadedThemes(new Set(safeThemes.map(t => t.id)))
      }
    } else {
      setLoadedThemes(new Set(safeThemes.map(t => t.id)))
    }
  }, [hasThemes, safeThemes])

  function handleSelect(theme: FontTheme) {
    setSelectedTheme(theme)
  }

  function handleApply() {
    if (!selectedTheme || isProcessing || !sendUserMessage) return

    sendUserMessage(
      t('builder_font_theme_apply_message', { themeName: selectedTheme.name }, `Apply font theme: {themeName}`),
      { isActionRequest: true }
    )
    setSelectedTheme(null)
  }

  function handleMoreOptions() {
    if (isProcessing || !sendUserMessage) return
    sendUserMessage(
      t('builder_font_theme_more_options_message', undefined, 'Show me more font options'),
      { isActionRequest: true }
    )
  }

  if (!hasThemes) {
    return null
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-2">
        {safeThemes.map((theme) => {
          const { headerFont, bodyFont } = normalizeFontTheme(theme)
          const isSelected = selectedTheme?.id === theme.id

          if (!headerFont || !bodyFont) return null

          const headerWeight = headerFont.weights[headerFont.weights.length - 1] || '700'
          const bodyWeight = bodyFont.weights[0] || '400'

          // Show font names - combine if different
          const fontLabel = headerFont.name === bodyFont.name
            ? headerFont.name
            : `${headerFont.name} + ${bodyFont.name}`

          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => handleSelect(theme)}
              style={{
                borderColor: isSelected ? '#000' : '#d1d5db',
                backgroundColor: isSelected ? '#f3f4f6' : '#fff',
                borderWidth: '2px'
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 cursor-pointer hover:!border-black hover:!bg-gray-100 hover:shadow-sm"
            >
              {/* Left: Theme info (fixed width) */}
              <div className="flex flex-col min-w-[110px] text-left">
                <div className="text-xs font-semibold text-gray-900 leading-tight">{theme.name}</div>
                <div className="text-[11px] text-gray-500 leading-tight truncate" title={fontLabel}>{fontLabel}</div>
              </div>

              {/* Right: Font previews (flex-grow) */}
              <div className="flex-1 flex flex-col gap-1 justify-center min-w-0">
                <div
                  className="text-[15px] font-bold text-gray-900 leading-tight"
                  style={{
                    fontFamily: `"${headerFont.name}", -apple-system, BlinkMacSystemFont, sans-serif`,
                    fontWeight: headerWeight
                  }}
                >
                  {t('builder_font_theme_preview_heading', undefined, 'Heading')}
                </div>

                <div
                  className="text-xs text-gray-600 leading-tight"
                  style={{
                    fontFamily: `"${bodyFont.name}", -apple-system, BlinkMacSystemFont, sans-serif`,
                    fontWeight: bodyWeight
                  }}
                >
                  {t('builder_font_theme_preview_sample', undefined, 'The quick brown fox jumps over the lazy dog')}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-1 flex-wrap justify-end pr-0.5">
        <Button
          text={t('builder_font_theme_more_options', undefined, 'More options')}
          design="tertiary"
          size="sm"
          disabled={isProcessing}
          onClick={handleMoreOptions}
        />

        <Button
          text={t('builder_font_theme_apply', undefined, 'Apply')}
          design="primary"
          size="sm"
          disabled={isProcessing || !selectedTheme}
          onClick={handleApply}
        />
      </div>
    </div>
  )
}
