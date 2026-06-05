import { ThreadedMessagePageChildren } from '@/lib/inbox/http/response/core'
import { Conversation } from '@/types/inbox/local/conversation'
import { IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'
import { Message } from '@/types/inbox/local/message'

export interface ConversationsRequest {
  brandId: UuidString
  until?: IsoDateTimeString
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
  hasMore: boolean
  until: IsoDateTimeString | undefined
}

export interface ConversationMessagesResponse {
  messages: Message[]
  hasMore: boolean
  until: IsoDateTimeString | undefined
  children: ThreadedMessagePageChildren | undefined
}