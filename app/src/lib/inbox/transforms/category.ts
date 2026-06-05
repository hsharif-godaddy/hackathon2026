import { ChannelType } from '@/types/inbox/local/category'
import { RemoteConversationCategory } from '@/types/inbox/remote/category'

/**
 * Category transform utilities
 *
 * Transforms raw Reamaze category data to the internal Category type.
 */

export const makeChannelType = (
  category: RemoteConversationCategory,
): ChannelType => {
  switch (category.channel_type) {
    case 1 /* Email */:
      if (category.visibility === 1) return 'WebChat'
      if (category.visibility === 0) return 'Email'
      return 'Unknown'
    case 3 /* Facebook */:
      return 'FacebookPage'
    case 8 /* Instagram */:
      return 'InstagramPage'
    case 12 /* Messenger */:
      return 'FacebookMessenger'
    case 13 /* FacebookLead */:
      return 'FacebookLead'
    case 14 /* InstagramAd */:
      return 'InstagramAd'
    case 15:
      return 'Whatsapp'
    case 16 /* InstagramDM */:
      return 'InstagramDM'
    case 17 /* GDTelephony */:
      return 'Telephony'
    case 18:
      if (category.slug === 'GuideBot') return 'GuideBot'
      if (category.slug === 'WebMessage') return 'WebMessage'
      return 'Unknown'
    case 19:
      return 'Google'
    default:
      return 'Unknown'
  }
}