/**
 * Visual Context Capture Utility
 * 
 * Captures the user's current visual context via dev-tools built into the app template.
 * The visual context script is automatically included in generated apps.
 */

/**
 * Validates if the message event origin is from a trusted source
 * 
 * @param origin - The origin to validate
 * @returns true if origin is allowed, false otherwise
 */
function isValidOrigin(origin: string): boolean {
  // Allow localhost origins for development
  return origin.startsWith('http://localhost:') || 
         origin.startsWith('https://localhost:') ||
         origin === 'http://127.0.0.1' ||
         origin === 'https://127.0.0.1' ||
         // Allow same origin
         origin === window.location.origin
}

import { postMessageToIframe } from '../../../utils/postMessage'

export interface VisualContext {
  page: string
  scroll_position: {
    x: number
    y: number
  }
  active_section?: string
  viewport: {
    width: number
    height: number
  }
  timestamp: number
}

/**
 * Captures the current visual context from the preview iframe.
 * Uses postMessage to communicate with dev-tools built into the app.
 */
export async function captureVisualContext(): Promise<VisualContext | null> {
  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement

  if (!iframe || !iframe.contentWindow) {
    return createFallbackContext()
  }

  try {
    const contextPromise = new Promise<VisualContext>((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[VisualContext] Timeout: No response from iframe after 500ms - check VITE_PARENT_ORIGIN is set correctly')
        resolve(createFallbackContext())
      }, 500) // Reduced from 3s to 500ms - context is now cached in iframe

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) {
          return
        }

        if (!isValidOrigin(event.origin)) {
          console.warn('[VisualContext] Message rejected: Invalid origin', event.origin)
          return
        }

        if (event.data.type === 'VISUAL_CONTEXT_RESPONSE') {
          clearTimeout(timeout)
          window.removeEventListener('message', handleMessage)
          resolve(event.data.context)
        }
      }

      window.addEventListener('message', handleMessage)
    })

    postMessageToIframe(iframe, {
      type: 'REQUEST_VISUAL_CONTEXT'
    })

    return await contextPromise

  } catch (error) {
    console.error('[VisualContext] Error:', error)
    return createFallbackContext()
  }
}

/**
 * Creates a fallback visual context when dev-tools are not available
 */
function createFallbackContext(): VisualContext {
  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
  
  return {
    page: '/',
    scroll_position: { x: 0, y: 0 },
    active_section: iframe?.contentWindow ? 'dev-tools-initializing' : 'no-iframe',
    viewport: {
      width: iframe?.clientWidth || 1200,
      height: iframe?.clientHeight || 800
    },
    timestamp: Date.now()
  }
}
