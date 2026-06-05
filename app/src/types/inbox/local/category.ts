import { BasicEntity } from '@/types/inbox/local/core'
import { RemoteEmailProvider, remoteEmailProviders } from '@/types/inbox/remote/category'

export type EmailProvider = RemoteEmailProvider
export const emailProviders: EmailProvider[] = [...remoteEmailProviders]

export type ChannelType =
  | 'Email'
  | 'WebChat'
  | 'FacebookPage'
  | 'FacebookLead'
  | 'FacebookMessenger'
  | 'Google'
  | 'InstagramPage'
  | 'InstagramAd'
  | 'InstagramDM'
  | 'Whatsapp'
  | 'Telephony'
  | 'GuideBot'
  | 'WebMessage'
  | 'Unknown'

export type ConversationCategory = BasicEntity &
  (
    | {
        readonly type: Exclude<ChannelType, 'Email' | 'WebChat'>
        readonly name: string
        readonly slug: string
      }
    | {
        readonly type: 'Email' | 'WebChat'
        readonly name: string
        readonly slug: string
        readonly provider: EmailProvider
        readonly email: string
        readonly wsbConnectable: boolean
      }
  )