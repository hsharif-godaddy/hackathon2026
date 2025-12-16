import { useParams } from "next/navigation"
import { RefObject } from "react"

import { logger } from '@/lib/request-context'
import type { ChatMessage, StreamingMessage, ToolCall } from '@/stores/useStreamingConversationStore'
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

/**
 * Get the render type for tool output display
 * Determines if tool output should be rendered as plain text (preserving formatting)
 * or as markdown (with rich formatting)
 *
 * @param toolName - The name of the tool
 * @returns 'plain' for tools that need preserved formatting (e.g., directory trees), 'markdown' otherwise
 */
export function getToolRenderType(toolName: string): 'plain' | 'markdown' {
  const plainTextTools = [
    'directoryListing',
    'directory_listing',
    // Add other tools that need plain text rendering here:
    // 'terminalCommand',
    // 'terminal_command',
    // 'grepSearch',
    // 'grep_search',
  ];
  return plainTextTools.includes(toolName) ? 'plain' : 'markdown';
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
      // Also request screenshot for thumbnail update
      postMessageToIframe(iframe, { type: 'REQUEST_SCREENSHOT' })
    } catch (error) {
      logger.error('develop.screenshot.request.failed', {
        error: error instanceof Error ? error.message : String(error)
      })
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

/**
 * Checks if a message is a StreamingMessage (active, incomplete message)
 *
 * @param message - Message to check
 * @returns True if message has isComplete property (StreamingMessage), false otherwise (ChatMessage)
 */
export function isStreamingMessage(message: ChatMessage | StreamingMessage): message is StreamingMessage {
  return 'isComplete' in message
}

/**
 * Checks if a message has valid segments for rendering
 *
 * @param message - Message to check
 * @returns True if message has non-empty segments array, false otherwise
 */
export function hasValidSegments(message: ChatMessage | StreamingMessage): boolean {
  return Boolean(message.segments && message.segments.length > 0)
}

/**
 * Extracts tool calls from a message
 *
 * @param message - Message to extract tool calls from
 * @returns Array of tool calls, or empty array if none exist
 */
export function getToolCallsFromMessage(message: ChatMessage | StreamingMessage): ToolCall[] {
  return message.toolCalls || []
}
