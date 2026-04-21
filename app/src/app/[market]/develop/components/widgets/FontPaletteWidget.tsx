'use client'

import { useEffect, useMemo } from 'react'

/**
 * Font data structure
 */
export interface FontInfo {
  name: string
  weight?: string | number
  category?: string
  fallback?: string
  description?: string
}

/**
 * Font palette widget props
 */
export interface FontPaletteWidgetProps {
  name?: string
  fonts: FontInfo[]
  className?: string
}

/**
 * Font Palette Widget
 *
 * Displays Google Fonts with preview examples:
 * - Loads fonts dynamically from Google Fonts
 * - Shows font name, category, and preview text
 * - Displays different font sizes and weights
 */
export default function FontPaletteWidget({ name, fonts, className = '' }: FontPaletteWidgetProps) {
  // Safely extract font data with fallbacks - memoized to prevent useEffect dependency changes
  const safeFonts = useMemo(() => fonts || [], [fonts])
  const hasFonts = safeFonts.length > 0

  useEffect(function loadGoogleFonts() {
    if (!hasFonts) return

    const fontFamilies = safeFonts
      .filter(font => font?.name)
      .map(font => {
        const fontName = font.name.replace(/\s+/g, '+')
        const weight = font.weight || '400'
        return `${fontName}:wght@${weight}`
      })
      .join('&family=')

    if (!fontFamilies) return

    const linkId = 'widget-google-fonts'
    let link = document.getElementById(linkId) as HTMLLinkElement

    if (!link) {
      link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }

    link.href = `https://fonts.googleapis.com/css2?family=${fontFamilies}&display=swap`
  }, [safeFonts, hasFonts])

  if (!hasFonts) {
    return (
      <div className={`rounded-lg border bg-white p-2 shadow-sm max-w-2xl ${className}`}>
        <p className="text-gray-500">No fonts to display</p>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border bg-white p-1.5 shadow-sm max-w-2xl ${className}`}>
      {/* Title */}
      {name && (
        <h3 className="text-base font-bold mb-1 text-gray-900">{name}</h3>
      )}

      <div className="space-y-1">
        {safeFonts.map((font, index) => {
          const fontFamily = font?.name || 'Arial'
          const fontWeight = font?.weight || '400'
          const fontFallback = font?.fallback || 'sans-serif'
          const fontDescription = font?.description || 'The quick brown fox jumps over the lazy dog'

          return (
            <div
              key={index}
              className="rounded borderp-1.5 space-y-1"
            >
              {/* Font preview samples */}
              <div className="space-y-1 pt-0.5">
                {/* Heading sample */}
                <div
                  className="text-xl leading-tight"
                  style={{
                    fontFamily: `"${fontFamily}", ${fontFallback}`,
                    fontWeight: fontWeight
                  }}
                >
                  {fontFamily}
                </div>

                {/* Character set sample - single line with wrapping */}
                <div
                  className="text-xs break-all"
                  style={{
                    fontFamily: `"${fontFamily}", ${fontFallback}`,
                    fontWeight: fontWeight
                  }}
                >
                  {fontDescription}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

