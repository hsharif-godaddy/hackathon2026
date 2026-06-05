import { ChannelType, ConversationCategory } from '@/types/inbox/local/category'
import { DataEntity, IsoDateTimeString } from '@/types/inbox/local/core'
import { Message } from '@/types/inbox/local/message'
import { User } from '@/types/inbox/local/user'
import { RemoteFormType } from '@/types/inbox/remote/conversation'

type FormType = RemoteFormType

export interface Form {
  // TODO: do not expose remote enums to local domain
  readonly type: FormType
  readonly title: string
  readonly form: ReadonlyArray<{
    readonly name: string
    readonly value: string
  }>
}

export type MessageType =
  | 'adComments'
  | 'adLead'
  | 'call'
  | 'chat'
  | 'contactForm'
  | 'email'
  | 'mention'
  | 'message'
  | 'postComments'
  | 'reaction'
  | 'review'
  | 'sms'

export interface Conversation extends DataEntity {
  readonly originalChannel: ChannelType
  readonly messageType: MessageType
  readonly category: ConversationCategory
  readonly c2: ReadonlyArray<User>
  readonly title?: string
  readonly subject?: string
  readonly summary?: {
    readonly text: string
    readonly createdAt: IsoDateTimeString
  }
  // readonly sentiment?: {
  //   readonly sentiment: 'unhappy' | 'neutral' | 'happy'
  //   readonly reason: string
  //   readonly createdAt: IsoDateTimeString
  //   readonly lastProcessedTimestamp: IsoDateTimeString
  // }
  readonly isArchived: boolean
  readonly isSpam: boolean
  readonly isStarred: boolean
  readonly isImportant: boolean
  readonly importantReason?: string
  // readonly isUnread: boolean
  readonly form?: Form
  // readonly lead?: Lead
  // readonly externalUrl?: UrlString
  readonly lastMessage: Message
  readonly messageCount: number
  // readonly customerLanguage?: string
  // readonly searchResult?: SearchResult
  // readonly replyableUntil?: IsoDateTimeString
  readonly isResolved: boolean
  readonly isUnresolved: boolean
  // readonly isPending: boolean
  readonly isOnHold: boolean
  readonly holdUntil?: IsoDateTimeString
}
