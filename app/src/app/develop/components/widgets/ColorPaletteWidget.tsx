'use client'

import { postMessageToIframe } from '@/utils/postMessage'
import text from '@ux/text'
import MapPinIcon from '@ux/icon/map-pin'
import clsx from 'clsx'

/**
 * Color data structure
 */
export interface ColorInfo {
  id: string
  name: string
  hex: string
  role?: string
  foreground?: string
}

/**
 * Color palette widget props
 */
export interface ColorPaletteWidgetProps {
  name?: string
  colors: ColorInfo[]
  theme?: 'light' | 'dark'
  className?: string
  isSelected?: boolean
}

/**
 * Color Palette Widget
 */
export default function ColorPaletteWidget({ name, colors, theme, className = '', isSelected = false }: ColorPaletteWidgetProps) {
  const safeColors = colors.slice(0, 5) // Take only first 5 colors

  if (safeColors.length === 0) {
    return (
      <div className={`rounded-lg border p-4 shadow-sm w-56 ${className}`}>
        <p className="text-sm">No colors to display</p>
      </div>
    )
  }

  // Pad to 5 colors if needed
  while (safeColors.length < 5) {
    safeColors.push({ id: '', name: '', hex: '#E5E7EB', role: '' })
  }

  const getColorById = (id: string) => {
    return colors.find(color => color.id === id)
  }

  /**
   * Handle click on palette - send preview message to iframe
   */
  function handleClick() {
    if (!name) return

    // Get the iframe element
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (!iframe || !iframe.contentWindow) {
      console.error('Could not find preview iframe')
      return
    }

    // Create palette data from colors
    const paletteData = {
      name,
      primary: getColorById('primary')?.hex || '#007bff',
      primaryForeground: getColorById('primary')?.foreground || '#000000',
      secondary: getColorById('secondary')?.hex || '#6c757d',
      secondaryForeground: getColorById('secondary')?.foreground || '#000000',
      accent: getColorById('accent')?.hex || '#17a2b8',
      accentForeground: getColorById('accent')?.foreground || '#000000',
      background: getColorById('base')?.hex || '#ffffff',
      foreground: getColorById('base')?.foreground || '#000000',
      destructive: getColorById('destructive')?.hex || '#ef4444',
      destructiveForeground: getColorById('destructive')?.foreground || '#000000',
    }

    // Post message to iframe to preview theme
    postMessageToIframe(iframe, {
      type: 'PREVIEW_THEME',
      palette: paletteData
    })

    // Emit custom event to notify grid of selection
    const event = new CustomEvent('palette-preview', {
      detail: paletteData
    })
    window.dispatchEvent(event)
  }

  return (
    <button
      className={clsx(
        "flex flex-row gap-2 justify-between items-center w-full p-4 rounded-md border-2 border-border transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor relative",
        className,
        {
          "border-intents-ux-boxHighContrast-borderColor shadow-md": isSelected,
        }
      )}
      style={{ backgroundColor: getColorById('base')?.hex, color: getColorById('base')?.foreground }}
      onClick={handleClick}
    >
      {theme && (
        <div
          className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-xs font-medium opacity-60"
          style={{
            backgroundColor: getColorById('primary')?.hex,
            color: getColorById('primary')?.foreground
          }}
        >
          {theme === 'dark' ? 'Dark' : 'Light'}
        </div>
      )}
      <div className="flex flex-col items-start">
        <text.span size={3} className="!font-semibold !leading-none">Aa</text.span>
        <text.span size={0} className="!font-thin !leading-none">Aa</text.span>
      </div>
      <div
        style={{ backgroundColor: getColorById('primary')?.hex, color: getColorById('primary')?.foreground }}
        className="size-12 rounded-sm flex items-center justify-center"
      >
        <MapPinIcon className="size-6" />
      </div>
    </button>
  )
}
