import { IframeMessageType } from '@/app/develop/components/types'
import { postMessageToIframe } from '@/utils/postMessage'

const IFRAME_ID = 'preview-iframe'

function getIframe(): HTMLIFrameElement | null {
  return document.getElementById(IFRAME_ID) as HTMLIFrameElement | null
}

/**
 * Broadcasts the current agent processing state to the preview iframe.
 * Called by the useEffect that watches isProcessing changes.
 */
export function broadcast(isProcessing: boolean) {
  const iframe = getIframe()
  if (iframe) {
    postMessageToIframe(iframe, { type: IframeMessageType.AGENT_PROCESSING_STATE, isProcessing })
  }
}

/**
 * Handles iframe message events related to processing state.
 * Returns true if the message was handled, false otherwise.
 */
export function handle(
  type: string,
  iframe: HTMLIFrameElement | null,
  isProcessing: boolean
): boolean {
  switch (type) {
    case 'request-processing-state':
      if (iframe) {
        postMessageToIframe(iframe, { type: IframeMessageType.AGENT_PROCESSING_STATE, isProcessing })
      }
      return true
    case 'build-page-request':
      if (isProcessing && iframe) {
        postMessageToIframe(iframe, { type: IframeMessageType.AGENT_PROCESSING_STATE, isProcessing: true })
      }
      return false
    default:
      return false
  }
}
