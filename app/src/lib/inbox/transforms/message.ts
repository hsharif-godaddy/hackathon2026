import { parseMediaType } from '@/lib/inbox/mime/core'
import { convertUser } from '@/lib/inbox/transforms/user'
import { Optional } from '@/types/inbox/local/core'
import { Attachment, Message } from '@/types/inbox/local/message'
import { RemoteAttachment, RemoteMessage } from '@/types/inbox/remote/message'

/**
 * Message transform utilities
 *
 * Transforms raw Reamaze message data to the internal Message type.
 */

const fileNamePattern = /^[^\s?&=]+\.([^\s?&=.]+)$/

export const convertAttachment = (attachment: RemoteAttachment): Attachment => {
  const parsedMediaType = parseMediaType(attachment.file_content_type)
  let name: Optional<string>
  let extension: Optional<string>
  // 1: looks like a filename (f.e. nsfw.xxx)
  if (attachment.file_file_name) {
    const match = attachment.file_file_name.match(fileNamePattern)
    if (match) {
      name = attachment.file_file_name
      extension = match[1]
    }
  }
  // 2: synthetic filename
  if (!name && parsedMediaType.extension) {
    name = `${attachment.id}.${parsedMediaType.extension}`
    extension = parsedMediaType.extension
  }
  return {
    id: attachment.id,
    url: attachment.url,
    // thumbnail: attachment.thumb_url,
    name,
    extension,
    size: attachment.file_file_size ?? 0,
    type: parsedMediaType.type,
    subType: parsedMediaType.subType,
    failed: false,
  }
}

const convertAttachments = (attachments: RemoteAttachment[]) =>
  attachments.reduce(
    (result, attachment) => {
      if (attachment.metadata === 'invalid') result.blockedAttachmentCount += 1
      else result.attachments.push(convertAttachment(attachment))
      return result
    },
    {
      attachments: [] as Attachment[],
      blockedAttachmentCount: 0,
    },
  )


export const convertMessage = (message: RemoteMessage): Message => {
  const hasAttachments = message.attachments.some(
    (attachment) => attachment.metadata !== 'invalid',
  )
  const trimmedBody = message.body?.trim()
  const hasBody = !!trimmedBody
  const trimmedOriginalBody = message.original_body?.trim()
  const hasOriginalBody = message.origin === 1 && !!trimmedOriginalBody
  const user = convertUser(message.user)
  const isInbound =
    user.isC2 ||
    (message.origin === 20 && user.isGuideBot) ||
    (message.origin === 3 && user.isSystem)
  // TODO: there should be a check for consistency of isCall, callType, callDuration, body and attachments[0].type = 'Audio'
  const isCall = message.origin === 10
  const attachmentsInfo = convertAttachments(message.attachments)

  return {
    id: message.id.toString(),
    conversationId: message.conversation_id.toString(),
    parentMessageId: message.parent_message_id?.toString(),
    originId: message.origin_id,
    body: hasBody ? trimmedBody : undefined,
    hasBody,
    originalBody: hasOriginalBody ? trimmedOriginalBody : undefined,
    hasOriginalBody,
    attachments: attachmentsInfo.attachments,
    hasAttachments: hasAttachments,
    blockedAttachmentCount: attachmentsInfo.blockedAttachmentCount,
    user,
    isInbound,
    isCall,
    // callType: makeCallType(message.meta?.call_sub_type),
    callDuration: message.meta?.call_duration,
    isSms: message.origin === 9,
    // deliveryStatus: !isInbound && !isCall && user.isC1 ? makeDeliveryStatus(message) : undefined,
    createdAt: message.created_at,
    // [!] follow server-side order
    // https://github.com/gdcorp-enm/reamaze/blob/main/app/controllers/api/v2/messages_controller.rb#L18
    bumpedAt: message.created_at,
    updatedAt: message.updated_at,
    isStoryMention: message.meta?.is_story_mention ?? false,
    ephemeral: message.meta?.ephemeral ?? false,
    isReaction: message.meta?.reaction ?? false,
    liked: message.meta?.liked ?? false,
    likable: message.meta?.likable ?? false,
    isUnsupported: message.meta?.is_unsupported ?? false,
    hidden: message.visibility === 4,
    isInternalNote: message.visibility === 1,
    childCount: message.child_count,
    language: message.meta?.language?.code,
    translation: message.meta?.translation?.en,
    readBy: message.read_by,
  }
}