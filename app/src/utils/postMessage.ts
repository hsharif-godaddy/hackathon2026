/**
 * Secure postMessage utilities for iframe communication
 */
import { logger } from '@/lib/request-context';

/**
 * Gets the target origin for postMessage calls
 *
 * Uses environment variable NEXT_PUBLIC_IFRAME_ORIGIN if set,
 * otherwise falls back to '*' (not recommended for production).
 *
 * @returns Target origin string for postMessage
 */
export function getTargetOrigin(): string {
  const iframeOrigin = process.env.NEXT_PUBLIC_IFRAME_ORIGIN

  if (iframeOrigin) {
    return iframeOrigin
  }

  logger.warn('post-message.no-origin-configured', { message: 'NEXT_PUBLIC_IFRAME_ORIGIN not set, using wildcard origin for postMessage (security risk)' })
  return '*'
}

/**
 * Validates if the message event origin is allowed
 *
 * @param event - MessageEvent to validate
 * @returns true if origin is allowed, false otherwise
 */
export function isOriginAllowed(event: MessageEvent): boolean {
  const allowedOrigin = process.env.NEXT_PUBLIC_IFRAME_ORIGIN

  if (!allowedOrigin || allowedOrigin === '*') {
    // If no specific origin is configured, we're in development mode
    // Allow localhost origins and airoapp.ai domains
    try {
      const url = new URL(event.origin)
      const hostname = url.hostname

      // Allow localhost and 127.0.0.1
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return true
      }

      // Allow any subdomain of airoapp.ai
      if (hostname.endsWith('.airoapp.ai') || hostname === 'airoapp.ai') {
        return true
      }

      return false
    } catch {
      return false
    }
  }

  // In production or when specific origin is set, only allow that exact origin
  return event.origin === allowedOrigin
}

/**
 * Safely posts a message to an iframe using the configured target origin
 *
 * @param iframe - The iframe element to send the message to
 * @param message - The message to send
 */
export function postMessageToIframe(iframe: HTMLIFrameElement, message: any): void {
  if (!iframe.contentWindow) {
    logger.warn('post-message.no-content-window', { message: 'Cannot send message: iframe contentWindow not available' })
    return
  }

  iframe.contentWindow.postMessage(message, getTargetOrigin())
}