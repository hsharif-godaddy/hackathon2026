'use client'

import React, { useRef } from 'react'

import ActionToolGroupRenderer from '@/app/[market]/develop/components/ActionToolGroupRenderer'
import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import MessageToolCallsRenderer from '@/app/[market]/develop/components/MessageToolCallsRenderer'
import ThinkingIndicator from '@/app/[market]/develop/components/ThinkingIndicator'
import MediaGroupRenderer from '@/app/[market]/develop/components/tool-renderers/MediaGroupRenderer'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { ContentBlock } from './contentBlocks'

interface MessageContentRendererProps {
  blocks: ContentBlock[]
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
  showThinking?: boolean
}

function MessageContentRenderer({ blocks, isActiveStream = false, isLastAssistantMessage = false, showThinking = false }: MessageContentRendererProps) {
  const toolCallArraysCacheRef = useRef<Map<string, ToolCall[]>>(new Map())

  // Create stable array references for tool calls using a cache
  blocks.forEach((block) => {
    if (block.type === 'tool' && block.toolCall) {
      const cached = toolCallArraysCacheRef.current.get(block.toolCall.id)
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

            {block.type === 'action-group' && block.toolCalls && (
              <ActionToolGroupRenderer
                toolCalls={block.toolCalls}
                isActiveStream={isActiveStream}
                isLastAssistantMessage={isLastAssistantMessage}
              />
            )}
          </div>
        )
      })}

      {showThinking && (
        <ThinkingIndicator active />
      )}
    </div>
  )
}

export default React.memo(MessageContentRenderer)
