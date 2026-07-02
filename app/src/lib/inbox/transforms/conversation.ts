import { enumOrDefault,isAnyOf } from '@/lib/inbox/domain/validation/core'
import { makeChannelType } from '@/lib/inbox/transforms/category'
import { convertMessage } from '@/lib/inbox/transforms/message'
import { selectC2 } from '@/lib/inbox/transforms/user'
import { logger } from '@/lib/request-context'
import { ChannelType, ConversationCategory, emailProviders } from '@/types/inbox/local/category'
import { Conversation, ConversationStatus, Form, MessageType } from '@/types/inbox/local/conversation'
import { Optional } from '@/types/inbox/local/core'
import { RemoteConversationCategory } from '@/types/inbox/remote/category'
import { RemoteConversation, RemoteConversationData } from '@/types/inbox/remote/conversation'
import { RemoteOrigin } from '@/types/inbox/remote/message'

/**
 * Conversation transform utilities
 *
 * Transforms raw Reamaze conversation data to the internal Conversation type.
 */

const formHiddenFields = [
  'device',
  'language',
  'submitted_from',
  'summary_data',
]

const safeString = (value: unknown): string => {
  if (value || value === 0 || value === false) {
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' || typeof value === 'boolean')
      return value.toString()
    if (typeof value === 'object') return Array.isArray(value) ? '[]' : '{}'
  }
  return ''
}

export const convertForm = (
  form?: RemoteConversationData,
  position?: string[],
): Optional<Form> => {
  if (!form || !form.__gd_type) return undefined

  const formData: { readonly name: string; readonly value: string }[] = []
  const keys = position && position.length > 0 ? position : Object.keys(form)
  for (const key of keys) {
    if (!key.startsWith('__') && !formHiddenFields.includes(key))
      formData.push({ name: key, value: safeString(form[key]) })
  }
  return {
    type: form.__gd_type,
    title: form.__gd_contact_form_title ?? '',
    fields: formData,
  }
}

const convertConversationCategory = (
  category: RemoteConversationCategory,
): ConversationCategory => {
  const type = makeChannelType(category)
  return type === 'Email' || type === 'WebChat'
    ? {
        id: category.id,
        name: category.name,
        slug: category.slug,
        type,
        // TODO: default provider value should be inferred from email
        provider: enumOrDefault(
          category.email_provider,
          emailProviders,
          'none',
        ),
        email: category.email,
        wsbConnectable: category.visibility === 1,
      }
    : {
        id: category.id,
        name: category.name,
        slug: category.slug,
        type,
      }
}

const convertMessageType = (
  conversation: RemoteConversation,
  originalChannel: ChannelType,
  isContactFormOrigin: boolean,
): MessageType => {
  if (originalChannel === 'WebChat')
    return isContactFormOrigin ? 'contactForm' : 'chat'
  if (originalChannel === 'Email')
    return isContactFormOrigin ? 'contactForm' : 'email'
  if (originalChannel === 'Telephony')
    return conversation.last_message.origin === 9 ? 'sms' : 'call'
  if (
    originalChannel === 'InstagramDM' &&
    conversation.last_message.meta?.is_story_mention
  )
    return 'mention'
  if (
    originalChannel === 'InstagramDM' &&
    conversation.last_message.meta?.reaction
  )
    return 'reaction'
  if (originalChannel === 'InstagramAd') return 'adComments'
  if (originalChannel === 'FacebookLead') return 'adLead'
  if (
    originalChannel === 'FacebookPage' ||
    originalChannel === 'InstagramPage'
  ) {
    if (conversation.visibility && conversation.external_data) {
      if (
        conversation.external_data.fb_rating_value ||
        conversation.external_data.fb_recommendation_type
      ) {
        return 'review'
      }
      return 'postComments'
    }
    // TODO: check if it's totally covered earlier
    if (conversation.external_data && conversation.external_data.fb_form_id) {
      return 'adLead'
    }
  }
  return 'message'
}

const subjectEnabled = [
  'FacebookPage',
  'InstagramPage',
  'FacebookLead',
  'InstagramAd',
  'Email',
]

const convertSubject = (
  conversation: RemoteConversation,
  channel: ChannelType,
): Optional<string> =>
  conversation.subject && subjectEnabled.includes(channel)
    ? conversation.subject
    : undefined

const getOriginalChannel = (
  channel: ChannelType,
  origin: RemoteOrigin,
): ChannelType => {
  if (channel === 'WebChat' || channel === 'Email')
    return origin === 0 ? 'WebChat' : 'Email'
  return channel
}

const deriveConversationStatus = (numericStatus: number, conversationId: number): ConversationStatus => {
  switch (numericStatus) {
    case 0: case 7: return 'unresolved'
    case 1: return 'pending'
    case 3: case 9: return 'spam'
    case 4: return 'archived'
    case 5: return 'onHold'
    case 2: case 6: case 8: return 'resolved'
    default:
      logger.warn('inbox.conversation.unknownStatus', { conversationId, status: numericStatus })
      return 'resolved'
  }
}

const UNKNOWN_CATEGORY: ConversationCategory = {
  id: 0,
  type: 'Unknown',
  name: 'Unknown',
  slug: 'unknown',
}

export const convertConversation = (
  conversation: RemoteConversation,
): Conversation => {
  const category = conversation.category
    ? convertConversationCategory(conversation.category)
    : UNKNOWN_CATEGORY
  const lastMessage = convertMessage(conversation.last_message)
  const bumpedAt =
    lastMessage.isInbound && lastMessage.createdAt > conversation.sort_timestamp
      ? lastMessage.createdAt
      : conversation.sort_timestamp
  const channel = getOriginalChannel(category.type, conversation.origin)
  const form = convertForm(
    conversation.data,
    conversation.external_data?.field_pos,
  )

  const isArchived = conversation.status === 4
  const isSpam = conversation.status === 3 || conversation.status === 9

  const status = deriveConversationStatus(conversation.status, conversation.id)

  return {
    id: conversation.id.toString(),
    originId: conversation.origin_id,
    originalChannel: channel,
    messageType: convertMessageType(
      conversation,
      channel,
      conversation.origin === 17,
    ),
    category,
    c2: selectC2(
      conversation.followers,
      isAnyOf(channel, 'GuideBot', 'FacebookLead'),
    ),
    title: conversation.subject || undefined,
    subject: convertSubject(conversation, channel),
    summary:
      conversation.summary_data?.content && conversation.summary_data.created_at
        ? {
            text: conversation.summary_data.content,
            createdAt: conversation.summary_data.created_at,
          }
        : undefined,
    lastMessage,
    isStarred: conversation.starred && !isSpam,
    isImportant: conversation.important && !isSpam && !isArchived,
    importantReason:
      conversation.important && !isSpam && !isArchived
        ? conversation.data?.__important_reason
        : undefined,
    form,
    status,
    isArchived,
    isSpam,
    messageCount: conversation.message_count,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
    bumpedAt,
    holdUntil: conversation.hold_until,
    isStaffOnly: conversation.staff_only ?? false,
  }
}
