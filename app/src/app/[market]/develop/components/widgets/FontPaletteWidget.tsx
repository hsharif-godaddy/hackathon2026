'use client'

import { useEffect } from 'react'
import PlusIcon from '@ux/icon/plus'
import text from '@ux/text'

import type { FontThemeSuggestFont } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest'

/**
 * Font palette widget props
 */
export interface FontPaletteWidgetProps {
  name?: string
  headerFont: FontThemeSuggestFont
  bodyFont: FontThemeSuggestFont
  className?: string
}

/**
 * Font Palette Widget
 *
 * Displays Google Fonts with preview matching the selected option style
 * from the font selection widget.
 */
export default function FontPaletteWidget({ name, headerFont, bodyFont, className = '' }: FontPaletteWidgetProps) {
  useEffect(function loadGoogleFonts() {
    const fontMap = new Map<string, Set<string>>()

    // Collect all weights for each unique font
    for (const font of [headerFont, bodyFont]) {
      if (!font?.name) continue
      const existing = fontMap.get(font.name) || new Set<string>()
      for (const w of font.weights) existing.add(w)
      fontMap.set(font.name, existing)
    }

    if (fontMap.size === 0) return

    const fontFamilies: string[] = []
    fontMap.forEach((weights, fontName) => {
      const encodedName = encodeURIComponent(fontName).replace(/%20/g, '+')
      const weightsStr = Array.from(weights).sort().join(';')
      fontFamilies.push(`${encodedName}:wght@${weightsStr}`)
    })

    const linkId = 'widget-google-fonts'
    let link = document.getElementById(linkId) as HTMLLinkElement

    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }

    link.href = `https://fonts.googleapis.com/css2?family=${fontFamilies.join('&family=')}&display=swap`
  }, [headerFont, bodyFont])

  const isSameFont = headerFont.name === bodyFont.name

  // Pick representative weights for display (with defensive fallbacks)
  const headerWeights = headerFont.weights || ['400', '700']
  const bodyWeights = bodyFont.weights || ['400', '600']
  const headerWeight = headerWeights[headerWeights.length - 1] || '700'
  const bodyWeight = bodyWeights[0] || '400'

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border-2 border-border px-1.5 py-1 bg-intents-ux-box-backgroundColor ${className}`}
    >
      {/* Theme name in header font */}
      <text.span
        className="truncate font-semibold leading-none"
        size={0}
        style={{
          fontFamily: `"${headerFont.name}", ui-sans-serif, system-ui, sans-serif`,
          fontWeight: headerWeight,
        }}
      >
        {name}
      </text.span>

      {/* Font pairing */}
      <div className="flex items-center gap-1 text-xs text-intents-ux-boxLowContrast-foregroundColor">
        {isSameFont ? (
          <span
            style={{
              fontFamily: `"${headerFont.name}", ui-sans-serif, system-ui, sans-serif`,
              fontWeight: headerWeight,
            }}
          >
            {headerFont.name}
          </span>
        ) : (
          <>
            <span
              style={{
                fontFamily: `"${headerFont.name}", ui-sans-serif, system-ui, sans-serif`,
                fontWeight: headerWeight,
              }}
            >
              {headerFont.name}
            </span>
            <PlusIcon className="size-2 shrink-0" />
            <span
              style={{
                fontFamily: `"${bodyFont.name}", ui-sans-serif, system-ui, sans-serif`,
                fontWeight: bodyWeight,
              }}
            >
              {bodyFont.name}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

