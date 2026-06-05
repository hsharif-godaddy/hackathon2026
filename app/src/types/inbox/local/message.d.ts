import { BasicEntity, DataEntity, IntString, UrlString } from '@/types/inbox/local/core'
import { User } from '@/types/inbox/local/user'
import { MessageOpen } from '@/types/inbox/remote/message'

export type AttachmentType = 'audio' | 'document' | 'image' | 'video'

export type AttachmentSubType =
  | 'audio'
  | 'video'
  | 'image'
  | 'calendar'
  | 'spreadsheet'
  | 'word'
  | 'pdf'
  | 'text'
  | 'presentation'
  | 'message'
  | 'file'
  | 'binary'
  | 'unknown'

export interface Attachment extends BasicEntity {
  readonly url: UrlString
  readonly thumbnail?: UrlString
  readonly name?: string
  readonly extension?: string
  readonly size: number
  readonly type: AttachmentType
  readonly subType?: AttachmentSubType
  readonly failed: boolean
}

export type CallType =
  | 'Answered'
  | 'Missed'
  | 'Rejected'
  | 'Outbound'
  | 'Transcription'
  | 'Voicemail'

export type MessageDeliveryStatus =
  | 'failed'
  | 'delivered'
  | 'sending'
  | 'sent'
  | 'read'

export interface Message extends DataEntity {
  readonly conversationId: IntString
  readonly parentMessageId?: IntString
  readonly body?: string
  readonly hasBody: boolean
  readonly originalBody?: string
  readonly hasOriginalBody: boolean
  readonly attachments: ReadonlyArray<Attachment>
  readonly hasAttachments: boolean
  readonly blockedAttachmentCount: number
  readonly user: User
  readonly isInbound: boolean
  readonly isCall: boolean
  readonly callType?: CallType
  readonly callDuration?: number
  readonly isSms: boolean
  readonly deliveryStatus?: MessageDeliveryStatus
  readonly isStoryMention: boolean
  readonly isUnsupported: boolean
  readonly ephemeral: boolean
  readonly isReaction: boolean
  readonly liked: boolean
  readonly likable: boolean
  readonly hidden: boolean
  readonly isInternalNote: boolean
  readonly childCount?: number
  readonly language?: string
  readonly translation?: string
  readonly readBy: ReadonlyArray<MessageOpen>
}