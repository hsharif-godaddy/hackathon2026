'use client'

import { useEffect, useState } from 'react'
import Button from '@ux/button'

import { useSendUserMessage } from '@/app/develop/components/chat/ChatContext'
import ColorPaletteWidget from '@/app/develop/components/widgets/ColorPaletteWidget'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Complete palette data structure (matches GeneratedPalette from backend)
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
 * Palette data for grid display
 */
export interface PaletteData {
  name: string
  theme?: 'light' | 'dark'
  palette: CompletePalette
}

/**
 * Color Palette Grid Widget Props
 */
export interface ColorPaletteGridWidgetProps {
  palettes: PaletteData[]
  className?: string
}

/**
 * Color Palette Grid Widget
 *
 * Displays multiple color palettes in a responsive grid layout with preview controls.
 * Users can preview color schemes before saving them.
 */
export default function ColorPaletteGridWidget({ palettes, className = '' }: ColorPaletteGridWidgetProps) {
  const t = useTranslations()
  const [previewedPalette, setPreviewedPalette] = useState<any>(null)
  const sendUserMessage = useSendUserMessage();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

  // Listen for palette preview events from child widgets
  useEffect(() => {
    function handlePalettePreview(event: Event) {
      const customEvent = event as CustomEvent
      setPreviewedPalette(customEvent.detail)
    }

    window.addEventListener('palette-preview', handlePalettePreview)
    return () => {
      window.removeEventListener('palette-preview', handlePalettePreview)
    }
  }, [])

  /**
   * Revert to original theme
   */
  function handleRevert() {
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
      postMessageToIframe(iframe, {
        type: 'REVERT_THEME'
      })
    }
    setPreviewedPalette(null)
    logger.debug('color_palette.preview.reverted', {
      message: 'Theme preview reverted'
    })
  }

  /**
   * Save the previewed theme by sending message to chat
   */
  function handleSave() {
    if (!previewedPalette || isProcessing || !sendUserMessage) {return}

    sendUserMessage(`${t('builder_tools_css_color_scheme_use_color')} ${previewedPalette.name}`, { isActionRequest: true })
    setPreviewedPalette(null)
  }

  /**
   * Handle "More options" button click
   */
  function handleMoreOptions() {
    if (isProcessing || !sendUserMessage) {return}

    sendUserMessage(t('builder_tools_css_color_scheme_more_options'), { isActionRequest: true })
  }

  // Check if palettes array is empty or invalid
  if (!palettes || palettes.length === 0) {
    return null
  }

  // Check if palettes have the new complete format (background + foreground)
  // If not, they're from the old version - return null to hide component
  const hasCompleteFormat = palettes.every(
    (p) => p.palette?.background && p.palette?.foreground
  )

  if (!hasCompleteFormat) {
    return null
  }

  return (
    <div className={className}>
      {/* Palette Grid */}
      <div className="grid grid-cols-2 gap-2">
        {palettes.map((paletteData, index) => (
          <ColorPaletteWidget
            key={index}
            name={paletteData.name}
            palette={paletteData.palette}
            isSelected={previewedPalette?.name === paletteData.name}
          />
        ))}
      </div>

      {/* Button Controls - Always visible */}
      <div className="mt-3 flex items-center gap-1 flex-wrap justify-end pr-0.5">

        <Button
          text={t('builder_common_more_options')}
          design="tertiary"
          size="sm"
          disabled={isProcessing}
          onClick={handleMoreOptions}
        />

        <Button
          text={t('builder_common_revert')}
          design="secondary"
          size="sm"
          onClick={handleRevert}
        />
        <Button
          text={t('builder_common_save')}
          design="primary"
          size="sm"
          disabled={isProcessing}
          onClick={handleSave}
        />
      </div>
    </div>
  )
}

