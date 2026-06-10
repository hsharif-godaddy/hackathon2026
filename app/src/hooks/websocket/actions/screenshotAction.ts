import { logger } from '@/lib/request-context'
import { isOriginAllowed, postMessageToIframe } from '@/utils/postMessage'
import type { ClientActionExecutor } from './types'

export const screenshotAction: ClientActionExecutor = async (params) => {
  const { type = 'viewport', route } = params as { type?: string; route?: string }

  const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-testid="preview-iframe"]')
  if (!iframe?.contentWindow) {
    throw new Error('Preview iframe not available for screenshot')
  }

  logger.info('client-action.screenshot.begin', { type, route })

  if (route) {
    postMessageToIframe(iframe, { type: 'RESTORE_STATE_AFTER_REFRESH', url: route })
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  const messageType = type === 'full' ? 'REQUEST_SCREENSHOT' : 'REQUEST_VIEWPORT_SCREENSHOT'
  const responseType = type === 'full' ? 'SCREENSHOT_RESPONSE' : 'VIEWPORT_SCREENSHOT_RESPONSE'

  const screenshot = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Screenshot capture timed out after 15s'))
    }, 15000)

    const handler = (event: MessageEvent): void => {
      if (!isOriginAllowed(event) || event.source !== iframe.contentWindow) return
      if (event.data?.type === responseType && typeof event.data.screenshot === 'string') {
        cleanup()
        resolve(event.data.screenshot as string)
      }
    }

    const cleanup = (): void => {
      clearTimeout(timeout)
      window.removeEventListener('message', handler)
    }

    window.addEventListener('message', handler)
    postMessageToIframe(iframe, { type: messageType })
  })

  logger.info('client-action.screenshot.success', { type, route, size: screenshot.length })

  return { screenshot }
}
