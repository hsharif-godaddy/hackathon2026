import { ThreadedMessagePageChildren } from '@/lib/inbox/http/response/core'
import { Conversation } from '@/types/inbox/local/conversation'
import { IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'
import { Message } from '@/types/inbox/local/message'

export interface ConversationsRequest {
  brandId: UuidString
  /** 1-indexed page number. Omitted means page 1. */
  page?: number
}

export interface ConversationRequest {
  brandId: UuidString
  conversationId: IntString
}

export interface ConversationMessagesRequest {
  /** Conversation ID */
  id: IntString
  brandId: UuidString
  until?: IsoDateTimeString
  childrenFetchData?: {
    until: IsoDateTimeString | undefined
    parentMessageId: IntString | undefined
  }
}

export interface ConversationsResponse {
  conversations: Conversation[]
  /** Total number of pages; the last page is `pageCount` (pages are 1-indexed). */
  pageCount: number
}

export interface ConversationMessagesResponse {
  messages: Message[]
  hasMore: boolean
  until: IsoDateTimeString | undefined
  children: ThreadedMessagePageChildren | undefined
}

export interface SendReplyRequest {
  brandId: UuidString
  conversationId: IntString
  body?: string
  attachments?: Array<{ id: number } | string>
  parentMessageId?: IntString
  isInternalNote?: boolean
  clientId?: string
}

export interface SendReplyResponse {
  message: Message
}
