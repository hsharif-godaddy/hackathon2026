import { Conversation } from '@/types/inbox/local/conversation'
import { IntString, UuidString } from '@/types/inbox/local/core'

export type ConversationActionName =
  | 'resolve'
  | 'unresolve'

export interface ConversationActionRequest {
  readonly brandId: UuidString
  readonly conversationIds: readonly IntString[]
  readonly action: ConversationActionName
}

export interface ConversationActionConfig {
  readonly optimisticTransform: (conversation: Conversation) => Conversation
  readonly canExecute: (conversation: Conversation) => boolean
}
