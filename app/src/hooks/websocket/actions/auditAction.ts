import { logger } from '@/lib/request-context'
import { isOriginAllowed, postMessageToIframe } from '@/utils/postMessage'
import type { ClientActionExecutor } from './types'

export interface AuditIssue {
  type: 'broken-image' | 'broken-link' | 'empty-section' | 'placeholder-text'
  detail: string
  src?: string
  href?: string
}

export const auditAction: ClientActionExecutor = async (params) => {
  const { route, validRoutes = [], includeScreenshot = false } = params as {
    route?: string
    validRoutes?: string[]
    includeScreenshot?: boolean
  }

  const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-testid="preview-iframe"]')
  if (!iframe?.contentWindow) {
    throw new Error('Preview iframe not available for audit')
  }

  logger.info('client-action.audit.begin', { route, validRoutes: validRoutes.length })

  if (route) {
    postMessageToIframe(iframe, { type: 'RESTORE_STATE_AFTER_REFRESH', url: route })
    await new Promise(resolve => setTimeout(resolve, 2500))
  }

  const issues = await new Promise<AuditIssue[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Audit timed out after 20s'))
    }, 20000)

    const handler = (event: MessageEvent): void => {
      if (!isOriginAllowed(event) || event.source !== iframe.contentWindow) return
      if (event.data?.type === 'AUDIT_RESPONSE' && Array.isArray(event.data.issues)) {
        cleanup()
        resolve(event.data.issues as AuditIssue[])
      }
    }

    const cleanup = (): void => {
      clearTimeout(timeout)
      window.removeEventListener('message', handler)
    }

    window.addEventListener('message', handler)
    postMessageToIframe(iframe, { type: 'REQUEST_AUDIT', validRoutes })
  })

  let screenshot: string | undefined
  if (includeScreenshot) {
    screenshot = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Screenshot timed out'))
      }, 15000)

      const handler = (event: MessageEvent): void => {
        if (!isOriginAllowed(event) || event.source !== iframe.contentWindow) return
        if (event.data?.type === 'VIEWPORT_SCREENSHOT_RESPONSE' && typeof event.data.screenshot === 'string') {
          cleanup()
          resolve(event.data.screenshot as string)
        }
      }

      const cleanup = (): void => {
        clearTimeout(timeout)
        window.removeEventListener('message', handler)
      }

      window.addEventListener('message', handler)
      postMessageToIframe(iframe, { type: 'REQUEST_VIEWPORT_SCREENSHOT' })
    })
  }

  logger.info('client-action.audit.success', { route, issueCount: issues.length })

  return { issues, screenshot }
}
