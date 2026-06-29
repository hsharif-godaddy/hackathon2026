import type { ToolCall } from '@/stores/useStreamingConversationStore'

export interface ContentBlock {
  type: 'text' | 'tool' | 'tool-group' | 'video-group' | 'action-group'
  content?: string
  toolCall?: ToolCall
  toolCalls?: ToolCall[]
  order: number
}
