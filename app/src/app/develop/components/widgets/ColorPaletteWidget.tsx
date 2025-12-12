'use client'

import { postMessageToIframe } from '@/utils/postMessage'
import text from '@ux/text'
import MapPinIcon from '@ux/icon/map-pin'
import clsx from 'clsx'

/**
 * Complete palette data structure
 */
export interface CompletePalette {
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  accent: string
  accentForeground: string
  background: string
  foreground: string
  muted: string
  mutedForeground: string
  border: string
  destructive: string
  destructiveForeground: string
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
}

/**
 * Color palette widget props
 */
export interface ColorPaletteWidgetProps {
  name?: string
  palette: CompletePalette
  className?: string
  isSelected?: boolean
}

/**
 * Color Palette Widget
 */
export default function ColorPaletteWidget({ name, palette, className = '', isSelected = false }: ColorPaletteWidgetProps) {

  /**
   * Handle click on palette - send preview message to iframe
   */
  function handleClick() {
    if (!name) return

    // Use complete palette for preview (matches updateCssColors exactly)
    const paletteData = {
      name,
      ...palette
    }

    // Get the iframe element
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement

    // Try to post message to iframe if available (for live preview)
    if (iframe && iframe.contentWindow) {
      postMessageToIframe(iframe, {
        type: 'PREVIEW_THEME',
        palette: paletteData
      })
    }

    // Always emit custom event to notify grid of selection
    // This ensures palette selection works even when preview is not available
    const event = new CustomEvent('palette-preview', {
      detail: paletteData
    })
    window.dispatchEvent(event)
  }

  const renderColorCircle = (color: string) => (
    <div className="size-4 rounded-full -ml-1" style={{ backgroundColor: color }}></div>
  )

  return (
    <button
      className={clsx(
        "flex flex-col w-full gap-2 p-2 rounded-md border-2 border-border transition-all duration-300 hover:shadow-md hover:cursor-pointer hover:border-intents-ux-boxHighContrast-borderColor relative",
        className,
        {
          "border-intents-ux-boxHighContrast-borderColor shadow-md": isSelected,
        }
      )}
      style={{ backgroundColor: palette?.background, color: palette?.foreground }}
      onClick={handleClick}
    >
      <div className="flex flex-row gap-1 justify-between items-center w-full">
        <div className="flex flex-col items-start">
          <text.span size={3} className="!font-semibold !leading-none">Aa</text.span>
          <text.span size={0} className="!font-thin !leading-none">Aa</text.span>
        </div>
        <div
          style={{ backgroundColor: palette?.primary, color: palette?.primaryForeground }}
          className="size-6 rounded-sm flex items-center justify-center"
        >
          <MapPinIcon className="size-3" />
        </div>
      </div>
      <div className="flex flex-row pl-1">
        {renderColorCircle(palette?.primary)}
        {renderColorCircle(palette?.secondary)}
        {renderColorCircle(palette?.accent)}
        {renderColorCircle(palette?.muted)}
      </div>
    </button>
  )
}
