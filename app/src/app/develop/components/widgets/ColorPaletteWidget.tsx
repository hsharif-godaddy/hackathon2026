'use client'

import { useState } from 'react'

/**
 * Color data structure
 */
export interface ColorInfo {
  name: string
  hex: string
  role?: string
}

/**
 * Calculate relative luminance of a color
 * 
 * @param hex - Hex color code
 * @returns Luminance value between 0 and 1
 */
function getLuminance(hex: string): number {
  const rgb = parseInt(hex.slice(1), 16)
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = (rgb >> 0) & 0xff
  
  const [rs, gs, bs] = [r, g, b].map(function normalize(c) {
    const val = c / 255
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  })
  
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Determine if white or black text should be used on a background color
 * 
 * @param hex - Background hex color
 * @returns '#FFFFFF' for white text or '#000000' for black text
 */
function getContrastColor(hex: string): string {
  const luminance = getLuminance(hex)
  return luminance > 0.5 ? '#000000' : '#FFFFFF'
}

/**
 * Color palette widget props
 */
export interface ColorPaletteWidgetProps {
  name?: string
  colors: ColorInfo[]
  className?: string
}

/**
 * Color Palette Widget
 * 
 * Displays a color palette in a Tailwind-style card layout:
 * - Shows color swatches with names and roles
 * - Displays hex codes for easy reference
 * - Compact, scannable design
 */
export default function ColorPaletteWidget({ name, colors, className = '' }: ColorPaletteWidgetProps) {
  const safeColors = colors || []

  if (safeColors.length === 0) {
    return (
      <div className={`rounded-lg border bg-white p-4 shadow-sm max-w-2xl ${className}`}>
        <p className="text-gray-500 text-sm">No colors to display</p>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border bg-white shadow-sm max-w-2xl overflow-hidden ${className}`}>
      {/* Header */}
      {name && (
        <div className="px-4 py-2 border-b bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-900">{name}</h3>
        </div>
      )}

      {/* Color Stack */}
      <div className="p-2">
        <div className="space-y-1">
          {safeColors.map((color, index) => {
            const colorHex = color?.hex || '#CCCCCC'
            const colorName = color?.name || `Color ${index + 1}`
            const colorRole = color?.role
            const textColor = getContrastColor(colorHex)

            return (
              <div
                key={index}
                className="rounded border overflow-hidden"
                style={{ backgroundColor: colorHex }}
              >
                {/* Color Swatch with Name and Role */}
                <div className="h-10 w-full flex flex-col p-1">
                  <div>
                    <div 
                      className="text-xs font-semibold leading-tight"
                      style={{ color: textColor }}
                    >
                      {colorName}
                    </div>
                    {colorRole && (
                      <div 
                        className="text-xs opacity-80 leading-tight"
                        style={{ color: textColor }}
                      >
                        {colorRole}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

