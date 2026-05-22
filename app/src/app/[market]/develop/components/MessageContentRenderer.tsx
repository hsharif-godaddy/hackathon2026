'use client'

import React, { useRef } from 'react'
import { Thinker } from '@airo/components/chat/thinker'

import ActionToolGroupRenderer from '@/app/[market]/develop/components/ActionToolGroupRenderer'
import { useThinkerLabel } from '@/app/[market]/develop/components/chat/useThinkerLabel'
import MarkdownRenderer from '@/app/[market]/develop/components/MarkdownRenderer'
import MessageToolCallsRenderer from '@/app/[market]/develop/components/MessageToolCallsRenderer'
import MediaGroupRenderer from '@/app/[market]/develop/components/tool-renderers/MediaGroupRenderer'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import type { ContentBlock } from './contentBlocks'

interface MessageContentRendererProps {
  blocks: ContentBlock[]
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
  showThinking?: boolean
}

// Stable key derived from underlying tool ids so that adding a new block to
// the message (and the resulting reordering of tool/tool-group/action-group
// transitions in the chronological stream) doesn't remount unrelated
// subtrees. Text blocks have no stable id; index keys are fine because they
// hold no local state worth preserving.
function blockKey(block: ContentBlock, index: number): string {
  if (block.type === 'tool' && block.toolCall) {
    return `tool-${block.toolCall.id}`
  }
  if ((block.type === 'tool-group' || block.type === 'action-group') && block.toolCalls?.length) {
    return `${block.type}-${block.toolCalls[0]!.id}`
  }
  return `text-${index}`
}

function MessageContentRenderer({ blocks, isActiveStream = false, isLastAssistantMessage = false, showThinking = false }: MessageContentRendererProps) {
  const thinkerLabel = useThinkerLabel()
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
          <div key={blockKey(block, index)}>
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
        <Thinker label={thinkerLabel} />
      )}
    </div>
  )
}

export default React.memo(MessageContentRenderer)
