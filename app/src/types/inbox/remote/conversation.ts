import {
  BasicEntity,
  IsoDateTimeString,
  UrlString,
  UuidString,
} from '@/types/inbox/local/core'
import { RemoteConversationCategory } from '@/types/inbox/remote/category'
import { RemoteMessage, RemoteOrigin } from '@/types/inbox/remote/message'
import { RemoteUser } from '@/types/inbox/remote/user'

// Enums
// https://github.com/gdcorp-enm/reamaze/blob/main/app/models/conversation.rb
// last sync: 6/3/26

export const remoteConversationVisibilities = <const>[
  /* Private */ 0, /* Public */ 1,
]
export type RemoteConversationVisibility =
  (typeof remoteConversationVisibilities)[number]

const remoteConversationStatuses = <const>[
  /* Open */ 0, /* Pending */ 1, /* Resolved */ 2, /* Spam */ 3,
  /* Archived */ 4, /* OnHold */ 5, /* AutoResolved */ 6, /* BotAssigned */ 7,
  /* BotResolved */ 8, /* Spam_AI */ 9,
]
export type RemoteConversationStatus =
  (typeof remoteConversationStatuses)[number]

const remoteFormTypes = <const>['contact', 'job', 'message', 'sms', 'unknown']
export type RemoteFormType = (typeof remoteFormTypes)[number]

export type RemoteConversationData = {
  [name: string]: unknown
  __gd_type?: RemoteFormType
  __gd_contact_form_title?: string
  device?: string
  language?: string
  submitted_from?: string
  __important_reason?: string
}

export interface RemoteConversation extends BasicEntity {
  category: RemoteConversationCategory
  last_message: RemoteMessage
  origin: RemoteOrigin
  data?: RemoteConversationData
  summary_data?: {
    content?: string
    created_at?: IsoDateTimeString
  }
  external_data?: {
    field_pos?: string[]
    fb_rating_value?: string
    fb_form_id?: string
    // FB post/review
    fb_parent_post_permalink?: UrlString
    fb_post_permalink?: UrlString
    // FB review
    fb_recommendation_type?: 'positive' | string
    // FB messenger
    fb_inbox_link?: UrlString
    fb_recipient_id?: string
    // IG post
    instagram_data?: {
      media_type?: string
      media_url?: UrlString
      shortcode?: string
      permalink?: UrlString
      ig_id?: string
    }
    outbound?: object
    replyable_until?: string
  }
  message: Pick<RemoteMessage, 'body'>
  status: RemoteConversationStatus
  origin_id: UuidString | string
  follower_count: number
  followers: RemoteUser[]
  author: RemoteUser
  subject?: string
  starred: boolean
  important: boolean
  visibility: RemoteConversationVisibility
  created_at: IsoDateTimeString
  updated_at: IsoDateTimeString
  sort_timestamp: IsoDateTimeString
  message_count: number
  hold_until?: IsoDateTimeString
}
