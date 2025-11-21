'use client'

import { useState, useEffect } from 'react'
import ColorPaletteWidget from './ColorPaletteWidget'
import { postMessageToIframe } from '@/utils/postMessage'
import Button from '@ux/button'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'

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
  const [previewedPalette, setPreviewedPalette] = useState<any>(null)
  const setInputValue = useStreamingConversationStore((state) => state.setInputValue)

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
    console.log('🔄 Theme preview reverted')
  }

  /**
   * Save the previewed theme by injecting message into chat
   */
  function handleSave() {
    if (!previewedPalette) return

    const message = `Use color scheme: ${previewedPalette.name}`

    // Find the chat input textarea by ID
    const chatInput = document.getElementById('chat-input-textarea') as HTMLTextAreaElement
    if (!chatInput) {
      console.error('Could not find chat input textarea')
      return
    }

    // Get React's internal instance to trigger onChange properly
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(chatInput, message)
    } else {
      chatInput.value = message
    }

    // Trigger React's onChange with a proper input event
    const inputEvent = new Event('input', { bubbles: true })
    chatInput.dispatchEvent(inputEvent)

    // Focus the textarea
    chatInput.focus()

    // Find the send button by ID and click it after a delay
    const sendButton = document.getElementById('chat-send-button') as HTMLButtonElement
    if (sendButton) {
      setTimeout(() => {
        if (!sendButton.disabled) {
          sendButton.click()
        }
      }, 150)
    }

    // Clear preview state
    setPreviewedPalette(null)
    console.log('💾 Theme save requested:', previewedPalette.name)
  }

  /**
   * Handle "More options" button click
   */
  function handleMoreOptions() {
    setInputValue('Show me more color scheme options')
    const inputElement = document.getElementById('chat-input-textarea')
    if (inputElement) {
      inputElement.focus()
    }
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
      <div className="grid grid-cols-2 gap-4">
        {palettes.map((paletteData, index) => (
          <ColorPaletteWidget
            key={index}
            name={paletteData.name}
            theme={paletteData.theme}
            palette={paletteData.palette}
            isSelected={previewedPalette?.name === paletteData.name}
          />
        ))}
      </div>

      {/* Button Controls - Always visible */}
      <div className="mt-6 flex items-center gap-2 flex-wrap justify-center">

        <Button
          text="More options"
          design="tertiary"
          size="sm"
          onClick={handleMoreOptions}
        />

        <Button
          text="Revert"
          design="secondary"
          size="sm"
          onClick={handleRevert}
        />
        <Button
          text="Save"
          design="primary"
          size="sm"
          onClick={handleSave}
        />
      </div>

    </div>
  )
}

