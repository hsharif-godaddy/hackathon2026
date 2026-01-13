'use client';

import { useEffect, useState } from 'react';
import Button from '@ux/button';

import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext';
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore';
import { useTranslations } from '@/hooks/useTranslations';

interface FontInfo {
  name: string
  weights: string[]
  category: string
}

interface FontTheme {
  id: string
  name: string
  description: string
  font: FontInfo
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

    const newFontFamilies: string[] = []
    safeThemes.forEach(theme => {
      if (theme.font?.name) {
        const fontName = theme.font.name.replace(/\s+/g, '+')
        const weights = theme.font.weights.join(';')
        newFontFamilies.push(`${fontName}:wght@${weights}`)
      }
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
          const font = theme.font
          const isLoaded = loadedThemes.has(theme.id)
          const isSelected = selectedTheme?.id === theme.id

          if (!font || !Array.isArray(font.weights) || font.weights.length === 0) return null

          const boldWeight = font.weights[font.weights.length - 1] || '700'
          const regularWeight = font.weights[0] || '400'

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
                <div className="text-[11px] text-gray-500 leading-tight">{font.name}</div>
              </div>

              {/* Right: Font previews (flex-grow) */}
              <div className="flex-1 flex flex-col gap-1 justify-center min-w-0">
                <div
                  className="text-[15px] font-bold text-gray-900 leading-tight"
                  style={{
                    fontFamily: `"${font.name}", -apple-system, BlinkMacSystemFont, sans-serif`,
                    fontWeight: boldWeight
                  }}
                >
                  {t('builder_font_theme_preview_heading', undefined, 'Heading')}
                </div>

                <div
                  className="text-xs text-gray-600 leading-tight"
                  style={{
                    fontFamily: `"${font.name}", -apple-system, BlinkMacSystemFont, sans-serif`,
                    fontWeight: regularWeight
                  }}
                >
                  {t('builder_font_theme_preview_sample', undefined, 'The quick brown fox jumps over the lazy dog')}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-1 flex-wrap justify-center">
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
