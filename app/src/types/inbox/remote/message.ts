import {
  BasicEntity,
  IsoDateTimeString,
  MediaTypeString,
  Nullable,
  UrlString,
  UuidString,
} from '@/types/inbox/local/core'
import { RemoteUser } from '@/types/inbox/remote/user'

// Enums
// https://github.com/gdcorp-enm/reamaze/blob/main/app/models/message.rb
// https://github.com/gdcorp-enm/reamaze/blob/main/app/lib/godaddy_telephony.rb
// last sync: 7/10/24

export const remoteOrigins = <const>[
  /* Native */ 0, /* Email */ 1, /* Twitter */ 2, /* Facebook */ 3,
  /* Chat */ 6, /* Api */ 7, /* Instagram */ 8, /* Sms */ 9, /* Voice */ 10,
  /* Custom */ 11, /* Whatsapp */ 15, /* Staff */ 16, /* Form */ 17,
  /* Community */ 18, /* InstagramDM */ 19, /* Guide */ 20, /* Google */ 21,
  /* System */ 100,
]
export type RemoteOrigin = (typeof remoteOrigins)[number]

export const remoteMessageVisibilities = <const>[
  /* All */ 0, /* Note */ 1, /* Collision */ 2, /* Suspended */ 3,
  /* Hidden */ 4, /* Soft_Deleted */ 5,
]
export type RemoteMessageVisibility = (typeof remoteMessageVisibilities)[number]

const remoteCallSubTypes = <const>[
  'inbound_answered',
  'inbound_missed',
  'inbound_rejected',
  'outbound',
  'recording',
  'transcription',
]
export type RemoteCallSubType = (typeof remoteCallSubTypes)[number]

// [!] https://www.twilio.com/docs/sms/api/message-resource#message-status-values
// [!] https://support.twilio.com/hc/en-us/articles/223134347-What-are-the-Possible-SMS-and-MMS-Message-Statuses-and-What-do-They-Mean-
const remoteDeliveryStatuses = <const>[
  'accepted',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivery_unknown',
  'delivered',
  'undelivered',
  'failed',
  'read',
  'canceled',
  'receiving',
  'received',
]
export type RemoteDeliveryStatus = (typeof remoteDeliveryStatuses)[number]

export interface RemoteAttachment extends BasicEntity {
  url: UrlString
  // thumb_url: Nullable<UrlString>
  file_content_type: MediaTypeString
  file_file_name: Nullable<string>
  file_file_size: Nullable<number>
  metadata?: Nullable<'invalid' | unknown>
  created_at: IsoDateTimeString
  updated_at: IsoDateTimeString
}

export interface MessageOpen {
  id: number
  name: string
}

export interface RemoteMessage extends BasicEntity {
  attachments: RemoteAttachment[]
  body: Nullable<string>
  children?: RemoteMessage[]
  child_count?: number
  conversation_id: number
  created_at: IsoDateTimeString
  meta?: {
    call_sub_type?: RemoteCallSubType
    call_duration?: number
    delivery_status?: RemoteDeliveryStatus
    // to?: string
    // from?: string
    is_story_mention?: boolean
    is_unsupported?: boolean
    ephemeral?: boolean
    reaction?: boolean
    liked?: boolean
    likable?: boolean
    language?: {
      code: string
      name: string
      reliable: boolean
    }
    translation?: {
      en: string
    }
  }
  origin: RemoteOrigin
  origin_id: UuidString | string
  original_body: Nullable<string>
  parent_message_id?: number
  read_by: MessageOpen[]
  updated_at: IsoDateTimeString
  user: RemoteUser
  visibility: RemoteMessageVisibility
}
