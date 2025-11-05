'use client'

import { useState, useEffect } from 'react'
import ColorPaletteWidget, { type ColorInfo } from './ColorPaletteWidget'
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Palette data for grid display
 */
export interface PaletteData {
  name: string
  colors: ColorInfo[]
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

  if (!palettes || palettes.length === 0) {
    return (
      <div className={`rounded-lg border bg-white p-4 shadow-sm ${className}`}>
        <p className="text-gray-500 text-sm">No palettes to display</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Palette Grid */}
      <div className="grid grid-cols-2 gap-6">
        {palettes.map((palette, index) => (
          <ColorPaletteWidget
            key={index}
            name={palette.name}
            colors={palette.colors}
            isSelected={previewedPalette?.name === palette.name}
          />
        ))}
      </div>

      {/* Preview Controls Footer */}
      {previewedPalette && (
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={handleRevert}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Revert
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors shadow-sm"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}

