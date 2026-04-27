'use client'

import { useEffect, useState } from 'react'
import Button from '@ux/button'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { CompletePalette, PaletteData } from '@/app/[market]/develop/components/types/colorScheme'
import ColorPaletteWidget from '@/app/[market]/develop/components/widgets/ColorPaletteWidget'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'
import { postMessageToIframe } from '@/utils/postMessage'

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
export default function ColorPaletteGridWidget(props: ColorPaletteGridWidgetProps) {
  const { data: isThemeSelectionChatEnabled } = useSwitchboard('airo-builder-theme-selection-chat')
  if (isThemeSelectionChatEnabled) {
    return <ColorPaletteGridWidgetModern {...props} />
  }
  return <ColorPaletteGridWidgetLegacy {...props} />
}

function ColorPaletteGridWidgetModern({ palettes, className = '' }: ColorPaletteGridWidgetProps) {
  const t = useTranslations()
  const [previewedPalette, setPreviewedPalette] = useState<(CompletePalette & { name: string }) | null>(null)
  const sendUserMessage = useSendUserMessage();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

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

  function handleSave() {
    if (!previewedPalette || isProcessing || !sendUserMessage) return

    sendUserMessage(`${t('builder_tools_css_color_scheme_use_color')} ${previewedPalette.name}`, { isActionRequest: true })
    setPreviewedPalette(null)
  }

  function handleMoreOptions() {
    if (isProcessing || !sendUserMessage) return

    handleRevert()

    sendUserMessage(t('builder_tools_css_color_scheme_more_options'), { isActionRequest: true })
  }

  if (!palettes || palettes.length === 0) {
    return null
  }

  const hasCompleteFormat = palettes.every(
    (p) => p.palette?.background && p.palette?.foreground
  )

  if (!hasCompleteFormat) {
    return null
  }

  return (
    <div className={className}>
      <div data-testid="color-palette-grid" className="grid grid-cols-2 gap-2">
        {palettes.map((paletteData, index) => (
          <ColorPaletteWidget
            key={index}
            name={paletteData.name}
            palette={paletteData.palette}
            isSelected={previewedPalette?.name === paletteData.name}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1 flex-wrap justify-end pr-0.5">

        <Button
          data-testid="color-palette-more-options"
          text={t('builder_common_more_options')}
          design="tertiary"
          size="sm"
          disabled={isProcessing}
          onClick={handleMoreOptions}
        />

        <Button
          data-testid="color-palette-revert"
          text={t('builder_common_revert')}
          design="secondary"
          size="sm"
          onClick={handleRevert}
        />
        <Button
          data-testid="color-palette-save"
          text={t('builder_common_save')}
          design="primary"
          size="sm"
          disabled={isProcessing || !previewedPalette}
          onClick={handleSave}
        />
      </div>
    </div>
  )
}

/** @deprecated Remove when `airo-builder-theme-selection-chat` is permanently on */
function ColorPaletteGridWidgetLegacy({ palettes, className = '' }: ColorPaletteGridWidgetProps) {
  const t = useTranslations()
  const [previewedPalette, setPreviewedPalette] = useState<(CompletePalette & { name: string }) | null>(null)
  const sendUserMessage = useSendUserMessage();
  const isStreaming = useIsActivelyStreaming();
  const isLoading = useIsLoading();
  const isProcessing = isStreaming || isLoading;

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

  function handleSave() {
    if (!previewedPalette || isProcessing || !sendUserMessage) return

    sendUserMessage(`${t('builder_tools_css_color_scheme_use_color')} ${previewedPalette.name}`, { isActionRequest: true })
    setPreviewedPalette(null)
  }

  function handleMoreOptions() {
    if (isProcessing || !sendUserMessage) return

    sendUserMessage(t('builder_tools_css_color_scheme_more_options'), { isActionRequest: true })
  }

  if (!palettes || palettes.length === 0) {
    return null
  }

  const hasCompleteFormat = palettes.every(
    (p) => p.palette?.background && p.palette?.foreground
  )

  if (!hasCompleteFormat) {
    return null
  }

  return (
    <div className={className}>
      <div data-testid="color-palette-grid" className="grid grid-cols-2 gap-2">
        {palettes.map((paletteData, index) => (
          <ColorPaletteWidget
            key={index}
            name={paletteData.name}
            palette={paletteData.palette}
            isSelected={previewedPalette?.name === paletteData.name}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1 flex-wrap justify-end pr-0.5">

        <Button
          data-testid="color-palette-more-options"
          text={t('builder_common_more_options')}
          design="tertiary"
          size="sm"
          disabled={isProcessing}
          onClick={handleMoreOptions}
        />

        <Button
          data-testid="color-palette-revert"
          text={t('builder_common_revert')}
          design="secondary"
          size="sm"
          onClick={handleRevert}
        />
        <Button
          data-testid="color-palette-save"
          text={t('builder_common_save')}
          design="primary"
          size="sm"
          disabled={isProcessing || !previewedPalette}
          onClick={handleSave}
        />
      </div>
    </div>
  )
}
