import { ThreadedMessagePageChildren } from '@/lib/inbox/http/response/core'
import { Conversation } from '@/types/inbox/local/conversation'
import { EmailString, IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'
import { InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter'
import { Message } from '@/types/inbox/local/message'

export interface ConversationsRequest {
  brandId: UuidString
  /** 1-indexed page number. Omitted means page 1. */
  page?: number
  filter?: InboxConversationStatusFilter
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
  /** Number of conversations per page (Reamaze default: 30). */
  pageSize: number
  /** Number of conversations silently dropped due to transformation errors. */
  droppedCount: number
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

export interface UpdateStaffNotificationEmailRequest {
  brandId: UuidString
  /** Reamaze staff id (numeric); used in the PUT path /api/v2/staff/{staffId}. */
  staffId: number
  notificationEmail: EmailString
}

export interface EmailNotificationsResponse {
  emailNotifications: boolean
}

export interface UpdateEmailNotificationsRequest {
  brandId: UuidString
  emailNotifications: boolean
}
