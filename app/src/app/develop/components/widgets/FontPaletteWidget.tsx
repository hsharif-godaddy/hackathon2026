'use client'

import { useEffect } from 'react'

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
  // Safely extract font data with fallbacks
  const safeFonts = fonts || []
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
      <div className={`rounded-lg border bg-white p-4 shadow-sm max-w-2xl ${className}`}>
        <p className="text-gray-500">No fonts to display</p>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm max-w-2xl ${className}`}>
      {/* Title */}
      {name && (
        <h3 className="text-base font-bold mb-2 text-gray-900">{name}</h3>
      )}

      <div className="space-y-2">
        {safeFonts.map((font, index) => {
          const fontFamily = font?.name || 'Arial'
          const fontWeight = font?.weight || '400'
          const fontCategory = font?.category || 'sans-serif'
          const fontFallback = font?.fallback || 'sans-serif'
          const fontDescription = font?.description || 'The quick brown fox jumps over the lazy dog'

          return (
            <div
              key={index}
              className="rounded border bg-gray-50 p-3 space-y-1.5"
            >
              {/* Font preview samples */}
              <div className="space-y-1.5 pt-1">
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
                  className="text-xs text-gray-600 break-all"
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

