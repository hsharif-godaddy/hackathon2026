/**
 * Secure postMessage utilities for iframe communication
 */
import { logger } from '@/lib/request-context';

/**
 * Safely posts a message to an iframe using the iframe's actual origin
 * @param iframe - The iframe element to send the message to
 * @param message - The message to send
 */
export function postMessageToIframe(iframe: HTMLIFrameElement, message: any): void {
  if (!iframe.contentWindow) {
    logger.warn('post-message.no-content-window', { message: 'Cannot send message: iframe contentWindow not available' })
    return
  }

  try {
    // Extract the origin from the iframe's src URL
    const iframeSrc = iframe.src
    const iframeUrl = new URL(iframeSrc)
    const targetOrigin = iframeUrl.origin
    iframe.contentWindow.postMessage(message, targetOrigin)
  } catch (error) {
    // Fallback to wildcard if URL parsing fails (still better than nothing)
    logger.error('post-message.origin-error', { message: 'Could not determine iframe origin, using wildcard', error: error instanceof Error ? error.message : String(error) })
    iframe.contentWindow.postMessage(message, '*')
  }
}