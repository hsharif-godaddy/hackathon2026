'use client'

import React from 'react'
import ToolRenderer from '@/app/develop/components/ToolRenderer'
import WidgetRenderer from '@/app/develop/components/WidgetRenderer'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

interface MessageToolCallsRendererProps {
  toolCalls: ToolCall[]
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
}

/**
 * Renders a single tool call, handling widgetRender special case
 *
 * @param toolCall - The tool call to render
 * @param index - Optional index for key generation
 * @param isActiveStream - Whether this is part of the active stream
 * @param isLastAssistantMessage - Whether this is the last assistant message
 * @returns React element for the tool call
 */
function renderToolCall(toolCall: ToolCall, index?: number, isActiveStream?: boolean, isLastAssistantMessage?: boolean) {
  if (toolCall.name === 'suggestedResponse' && !isLastAssistantMessage) {
    return null
  }

  const isWidgetRender = toolCall.name === 'widgetRender' &&
    toolCall.result &&
    typeof toolCall.result === 'object' &&
    (toolCall.result as any).widgetData

  return (
    <div key={toolCall.id || `tool-${index}`}>
      {isWidgetRender ? (
        <WidgetRenderer
          widgetData={(toolCall.result as any).widgetData}
          className="my-4"
        />
      ) : (
        <ToolRenderer toolCall={toolCall} />
      )}
    </div>
  )
}

/**
 * Renders a list of tool calls
 *
 * Displays tool calls in a vertical list with spacing. Handles the widgetRender
 * special case by rendering widgets instead of tool call UI.
 *
 * @param toolCalls - Array of tool calls to render
 * @returns React element containing all tool calls, or null if empty
 */
function MessageToolCallsRenderer({ toolCalls, isActiveStream = false, isLastAssistantMessage = false }: MessageToolCallsRendererProps) {

  return (
    <div className="space-y-2">
      {toolCalls.map((toolCall, index) => renderToolCall(toolCall, index, isActiveStream, isLastAssistantMessage))}
    </div>
  )
}

export default React.memo(MessageToolCallsRenderer)

