'use client'

import React, { useRef } from 'react'

import MarkdownRenderer from '@/app/develop/components/MarkdownRenderer'
import MessageToolCallsRenderer from '@/app/develop/components/MessageToolCallsRenderer'
import MediaGroupRenderer from '@/app/develop/components/tool-renderers/MediaGroupRenderer'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

export interface ContentBlock {
  type: 'text' | 'tool' | 'tool-group'
  content?: string
  toolCall?: ToolCall
  toolCalls?: ToolCall[]
  order: number
}

interface MessageContentRendererProps {
  blocks: ContentBlock[]
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
}

/**
 * Renders chronological content blocks from message segments
 *
 * Displays text and tool call blocks in chronological order, maintaining
 * the proper sequence of content as it was streamed or stored.
 *
 * @param blocks - Array of content blocks to render in order
 * @param isActiveStream - Whether this is part of the active stream
 * @param isLastAssistantMessage - Whether this is the last assistant message
 * @returns React element containing all content blocks
 */
function MessageContentRenderer({ blocks, isActiveStream = false, isLastAssistantMessage = false }: MessageContentRendererProps) {
  const toolCallArraysCacheRef = useRef<Map<string, ToolCall[]>>(new Map())

  // Create stable array references for tool calls using a cache
  // This ensures React.memo in MessageToolCallsRenderer works correctly
  // Arrays are stable across renders unless the toolCall itself changes
  blocks.forEach((block) => {
    if (block.type === 'tool' && block.toolCall) {
      const cached = toolCallArraysCacheRef.current.get(block.toolCall.id)
      // Only create new array if toolCall reference changed or doesn't exist
      if (!cached || cached[0] !== block.toolCall) {
        toolCallArraysCacheRef.current.set(block.toolCall.id, [block.toolCall])
      }
    }
  })

  return (
    <div className="space-y-1">
      {blocks.map((block, index) => {
        const toolCallArray = block.type === 'tool' && block.toolCall
          ? toolCallArraysCacheRef.current.get(block.toolCall.id)
          : null

        return (
          <div key={`block-${index}`}>
            {block.type === 'text' && block.content && (
              <MarkdownRenderer
                content={block.content}
                className="text-sm leading-relaxed break-words"
              />
            )}

            {block.type === 'tool' && block.toolCall && toolCallArray && (
              <MessageToolCallsRenderer toolCalls={toolCallArray} isActiveStream={isActiveStream} isLastAssistantMessage={isLastAssistantMessage} />
            )}

            {block.type === 'tool-group' && block.toolCalls && (
              <MediaGroupRenderer toolCalls={block.toolCalls} isActiveStream={isActiveStream} isLastAssistantMessage={isLastAssistantMessage} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default React.memo(MessageContentRenderer)

