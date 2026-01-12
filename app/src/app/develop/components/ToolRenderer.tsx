'use client'

import { getConversationIdFromCookie } from '@/hooks/websocket/useWebSocketHelpers'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import { getToolRenderer } from './tool-renderers'

/**
 * Props for the ToolRenderer component
 */
interface ToolRendererProps {
  toolCall: ToolCall
  className?: string
  /** Whether this tool is in the last assistant message */
  isLastAssistantMessage?: boolean
}

/**
 * Renders a tool call using the appropriate renderer
 *
 * Dynamically loads and renders the appropriate tool renderer component based on
 * the tool name. Falls back to DefaultToolRenderer if no custom renderer exists.
 *
 * Passes toolId and conversationId to enable widget state persistence.
 *
 * @param toolCall - The tool call data to render
 * @param className - Optional CSS classes to apply to the container
 * @returns The rendered tool component
 */
function ToolRenderer({ toolCall, className = '', isLastAssistantMessage = false }: ToolRendererProps) {
  const currentAppId = useStreamingConversationStore(state => state.currentAppId)
  const conversations = useStreamingConversationStore(state => state.conversations)
  const conversationId = (currentAppId ? getConversationIdFromCookie(currentAppId) : null) ?? conversations[0]?.id

  const ToolRendererComponent = getToolRenderer(toolCall.name)

  return (
    <div className={`my-0.5 ${className}`}>
      <ToolRendererComponent
        toolName={toolCall.name}
        toolStatus={toolCall.status}
        toolId={toolCall.id}
        conversationId={conversationId}
        duration={toolCall.duration}
        input={toolCall.input}
        result={toolCall.result}
        error={toolCall.error}
        startTime={toolCall.startTime}
        endTime={toolCall.endTime}
        partialInput={toolCall.partialInput}
        isLastAssistantMessage={isLastAssistantMessage}
      />
    </div>
  )
}

export default ToolRenderer
