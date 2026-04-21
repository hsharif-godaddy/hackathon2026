'use client'

import React from 'react'

import ToolRenderer from '@/app/[market]/develop/components/ToolRenderer'
import WidgetRenderer from '@/app/[market]/develop/components/WidgetRenderer'
import { useSwitchboard } from '@/hooks/useSwitchboard'
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
function renderToolCall(toolCall: ToolCall, index?: number, isActiveStream?: boolean, isLastAssistantMessage?: boolean, chatPlansEnabled?: boolean) {
  // When chat plans are enabled, NBAs live in InputActionsPanel — never render in message stream.
  // Otherwise, only render suggestedResponse on the last assistant message.
  if (toolCall.name === 'suggestedResponse' && (!isLastAssistantMessage || chatPlansEnabled)) {
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
          className="my-2"
        />
      ) : (
        <ToolRenderer toolCall={toolCall} isLastAssistantMessage={isLastAssistantMessage} />
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
  const { data: areChatPlansEnabled } = useSwitchboard('airo-builder-chat-plans')

  return (
    <div className="space-y-1">
      {toolCalls.map((toolCall, index) => renderToolCall(toolCall, index, isActiveStream, isLastAssistantMessage, areChatPlansEnabled))}
    </div>
  )
}

export default React.memo(MessageToolCallsRenderer)
