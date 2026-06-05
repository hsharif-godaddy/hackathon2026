import { BasicEntity } from '@/types/inbox/local/core'

export const remoteChannelTypes = <const>[
  /* Email */ 1, /* Twitter */ 2, /* Facebook */ 3, /* Forum */ 5, /* Chat */ 6,
  /* Instagram */ 8, /* Sms */ 9, /* Voice */ 10, /* Custom */ 11,
  /* Messenger */ 12, /* FacebookLead */ 13, /* InstagramAd */ 14,
  /* Whatsapp */ 15, /* InstagramDM */ 16, /* GDTelephony */ 17,
  /* Internal */ 18, /* GBM */ 19, /* Tiktok */ 20,
]
export type RemoteChannelType = (typeof remoteChannelTypes)[number]

export const remoteCategoryVisibilities = <const>[
  /* Private */ 0, /* Public */ 1, /* Privileged */ 2,
]
export type RemoteCategoryVisibility =
  (typeof remoteCategoryVisibilities)[number]

export const remoteEmailProviders = <const>[
  'none',
  'o365',
  'gmail',
  'email_lite',
  'custom',
]
export type RemoteEmailProvider = (typeof remoteEmailProviders)[number]

export interface RemoteConversationCategory extends BasicEntity {
  name: string
  slug: string
  email: string
  visibility: RemoteCategoryVisibility
  channel_type: RemoteChannelType
  email_provider?: RemoteEmailProvider
}