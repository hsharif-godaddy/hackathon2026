import { RefObject } from "react"
import { useParams } from "next/navigation"
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Serializes tool arguments to a string format for consistent display in components.
 * Handles both string and object types, converting objects to formatted JSON.
 *
 * @param toolArgs - Tool arguments that can be string, object, or undefined
 * @returns Serialized string or undefined if input is undefined
 */
export function serializeToolArgs(toolArgs: string | object | undefined): string | undefined {
  if (toolArgs === undefined || toolArgs === null) {
    return undefined
  }

  if (typeof toolArgs === 'string') {
    return toolArgs
  }

  if (typeof toolArgs === 'object') {
    return JSON.stringify(toolArgs)
  }

  // For any other type, convert to string
  return String(toolArgs)
}

export function useAppIdFromParams() {
  const params = useParams()
  return params?.id as string || ''
}

export function handlePreviewRefresh({ lastIframeState }: { lastIframeState: RefObject<any> }) {
  // First request current visual context to capture scroll position
  const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
  if (iframe && iframe.contentWindow) {
    try {
      postMessageToIframe(iframe, { type: 'REQUEST_VISUAL_CONTEXT' })
    } catch (error) {
      console.error('Cannot request visual context:', error)
    }

    // Wait a bit for the response, then refresh with whatever state we have
    setTimeout(() => {
      window.postMessage({
        type: 'preview-refresh',
        preserveState: lastIframeState.current
      }, window.location.origin)
    }, 100) // Short delay to allow visual context response
  } else {
    // No iframe available, just refresh
    window.postMessage({ type: 'preview-refresh' }, window.location.origin)
  }
}
