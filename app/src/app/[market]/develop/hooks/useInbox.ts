import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'

import { queryKeys } from '@/lib/inbox/constants/queryKeys'
import { ThreadedMessagePageChildren } from '@/lib/inbox/http/response/core'
import { convertConversation } from '@/lib/inbox/transforms/conversation'
import { convertMessage } from '@/lib/inbox/transforms/message'
import { convertStaff } from '@/lib/inbox/transforms/staff'
import { Conversation } from '@/types/inbox/local/conversation'
import { IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'
import { InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter'
import { Message } from '@/types/inbox/local/message'
import { Staff } from '@/types/inbox/local/staff'
import { RemoteConversation } from '@/types/inbox/remote/conversation'
import { RemoteEmailNotifications } from '@/types/inbox/remote/emailNotifications'
import { RemoteMessage } from '@/types/inbox/remote/message'
import {
  ConversationMessagesRequest,
  ConversationMessagesResponse,
  ConversationRequest,
  ConversationsRequest,
  ConversationsResponse,
  EmailNotificationsResponse,
  SendReplyRequest,
  SendReplyResponse,
  UpdateEmailNotificationsRequest,
  UpdateStaffNotificationEmailRequest,
} from '@/types/inbox/remote/reamaze'

export async function getInboxConversations(params: ConversationsRequest): Promise<ConversationsResponse> {
  if (!params.brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/conversations', window.location.origin)
  url.searchParams.set('brandId', params.brandId)
  if (params.page) {
    url.searchParams.set('page', params.page.toString())
  }
  if (params.filter && params.filter !== 'all') {
    url.searchParams.set('filter', params.filter)
  }

  const response = await fetch(url.toString(), {
    credentials: 'include',
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to get conversations: ${response.status}`);
  }

  const remoteResponse = await response.json()

  if (!Array.isArray(remoteResponse?.conversations)) {
    throw new Error('Invalid conversations response format: conversations is not an array')
  }

  const total = remoteResponse.conversations.length

  const conversations = remoteResponse.conversations.flatMap((c: RemoteConversation) => {
    try {
      return [convertConversation(c)]
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.error('Failed to transform conversation:', {
        conversationId: c?.id,
        error: e.message,
      })
      return []
    }
  })

  const failureCount = total - conversations.length

  if (total > 0 && failureCount > Math.ceil(total * 0.2)) {
    throw new Error(
      `Conversation transform failure: ${failureCount}/${total} conversations failed to parse`,
    )
  }

  // Reamaze returns the total number of pages; fall back to a single page when
  // it is absent. The last page is `pageCount` (pages are 1-indexed).
  const pageCount =
    typeof remoteResponse.page_count === 'number' && remoteResponse.page_count > 0
      ? remoteResponse.page_count
      : 1

  return {
    conversations,
    pageCount,
  }
}

async function getInboxConversation(params: ConversationRequest): Promise<Conversation> {
  if (!params.conversationId) {
    throw new Error('Conversation ID is required')
  }

  if (!params.brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/conversation', window.location.origin)
  url.searchParams.set('brandId', params.brandId)
  url.searchParams.set('conversationId', params.conversationId)

  const response = await fetch(url.toString(), {
    credentials: 'include',
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Failed to get conversation: ${response.status}`);
  }

  const remoteResponse = await response.json()

  if (!remoteResponse?.conversation || typeof remoteResponse.conversation !== 'object') {
    throw new Error('Invalid conversation response format: conversation is missing')
  }

  try {
    return convertConversation(remoteResponse.conversation)
  } catch (transformError) {
    throw new Error(
      `Failed to transform conversation: ${transformError instanceof Error ? transformError.message : 'Unknown transformation error'}`,
    )
  }
}

async function getInboxConversationMessages(params: ConversationMessagesRequest): Promise<ConversationMessagesResponse> {
  if (!params.id) {
    throw new Error('Conversation ID is required')
  }

  if (!params.brandId) {
    throw new Error('Brand ID is required')
  }

  const fetchingChildren = !!params.childrenFetchData?.parentMessageId
  const until = fetchingChildren
    ? params.childrenFetchData?.until
    : params.until

  const url = new URL('/api/inbox/messages', window.location.origin)
  url.searchParams.set('brandId', params.brandId)
  if (fetchingChildren && params.childrenFetchData?.parentMessageId) {
    url.searchParams.set('parentMessageId', params.childrenFetchData.parentMessageId)
  } else {
    url.searchParams.set('conversationId', params.id)
  }
  if (until) {
    url.searchParams.set('before_timestamp', until)
  }

  const response = await fetch(url.toString(), {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      `Failed to get conversation messages by ID: ${response.status}`,
    )
  }

  const remoteResponse = await response.json()

  if (!Array.isArray(remoteResponse?.messages)) {
    throw new Error('Invalid messages response format: messages is not an array')
  }

  try {
    const children: ThreadedMessagePageChildren = {}

    const getUntil = (messages: Message[]) => {
      const lastMessage = messages[messages.length - 1]
      let nextUntil = until
      if (lastMessage && (!until || until > lastMessage.bumpedAt)) {
        nextUntil = lastMessage.bumpedAt
      }
      return nextUntil
    }

    let hasChildren = false
    const buildChildren = (message: RemoteMessage) => {
      if (!message.child_count) {
        return
      }

      hasChildren = true
      const childrenItems =
        message.children?.map((child) => {
          buildChildren(child)
          return convertMessage(child)
        }) ?? []

      children[message.id.toString()] = {
        totalCount: message.child_count,
        hasMore: message.child_count > childrenItems.length,
        until: getUntil(childrenItems),
        items: childrenItems,
      }
    }

    for (const message of remoteResponse.messages) {
      buildChildren(message)
    }

    let isChild = false
    const items = remoteResponse.messages.map((message: RemoteMessage) => {
      isChild = isChild || !!message.parent_message_id
      return convertMessage(message)
    })

    if (isChild && params.childrenFetchData?.parentMessageId) {
      hasChildren = true
      children[params.childrenFetchData.parentMessageId] = {
        totalCount: remoteResponse.total_count,
        items: items,
        hasMore: remoteResponse.total_count > items.length,
        until: getUntil(items),
      }
    }

    return {
      messages: isChild ? [] : items,
      hasMore: remoteResponse.total_count > items.length,
      until: getUntil(items),
      children: hasChildren ? children : undefined,
    }
  } catch (transformError) {
    throw new Error(
      `Failed to transform conversation messages data: ${transformError instanceof Error ? transformError.message : 'Unknown transformation error'}`,
    )
  }
}

export function useInboxConversations(
  brandId: UuidString,
  page?: number,
  filter?: InboxConversationStatusFilter,
): UseQueryResult<ConversationsResponse, Error> {
  return useQuery({
    queryKey: queryKeys.inboxConversations(brandId, page, filter),
    queryFn: () => getInboxConversations({ brandId, page, filter }),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      console.error('Error fetching conversations:', error)
      return failureCount < 3
    },
    enabled: !!brandId
  })
}

export function useInboxConversation(
  brandId: UuidString,
  conversationId: IntString
) {
  return useQuery({
    queryKey: queryKeys.inboxConversation(brandId, conversationId),
    queryFn: () => getInboxConversation({ brandId, conversationId }),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      console.error('Error fetching conversation:', error)
      return failureCount < 3
    },
    enabled: !!conversationId
  })
}

export function useInboxConversationMessages(
  conversationId: IntString,
  brandId: UuidString,
  until?: IsoDateTimeString,
  childrenFetchData?: {
    until: IsoDateTimeString | undefined
    parentMessageId: IntString | undefined
  },
) {
  return useQuery({
    queryKey: queryKeys.inboxConversationMessages(
      conversationId,
      brandId,
      until,
      childrenFetchData,
    ),
    queryFn: () =>
      getInboxConversationMessages({
        id: conversationId,
        brandId,
        until,
        childrenFetchData,
      }),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      console.error('Error fetching conversation messages:', error)
      return failureCount < 3
    },
    enabled: !!conversationId, // Only run query if conversationId is provided
  })
}

export async function sendInboxReply(params: SendReplyRequest): Promise<SendReplyResponse> {
  if (!params.brandId) {
    throw new Error('Brand ID is required')
  }
  if (!params.conversationId) {
    throw new Error('Conversation ID is required')
  }

  const response = await fetch('/api/inbox/messages', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to send reply: ${response.status}`)
  }

  return response.json() as Promise<SendReplyResponse>
}

export function useSendInboxReply(brandId: UuidString, conversationId: IntString) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: Omit<SendReplyRequest, 'brandId' | 'conversationId'>) =>
      sendInboxReply({ ...params, brandId, conversationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.inboxConversationMessages(conversationId, brandId),
      })
    },
  })
}

async function getInboxStaff(brandId: UuidString): Promise<Staff> {
  if (!brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/staff', window.location.origin)
  url.searchParams.set('brandId', brandId)

  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to get staff: ${response.status}`)
  }

  const remoteResponse = await response.json()

  if (!remoteResponse?.staff || typeof remoteResponse.staff !== 'object') {
    throw new Error('Invalid staff response format: staff is missing')
  }

  try {
    return convertStaff(remoteResponse.staff)
  } catch (transformError) {
    throw new Error(
      `Failed to transform staff: ${transformError instanceof Error ? transformError.message : 'Unknown transformation error'}`,
    )
  }
}

async function getInboxEmailNotifications(brandId: UuidString): Promise<EmailNotificationsResponse> {
  if (!brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/email-notifications', window.location.origin)
  url.searchParams.set('brandId', brandId)

  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to get email notifications: ${response.status}`)
  }

  const remote = (await response.json()) as RemoteEmailNotifications

  if (typeof remote?.email_notifications !== 'boolean') {
    throw new Error('Invalid email notifications response format: email_notifications is not a boolean')
  }

  return { emailNotifications: remote.email_notifications }
}

async function putInboxStaffNotificationEmail(
  params: UpdateStaffNotificationEmailRequest,
): Promise<Staff> {
  const response = await fetch('/api/inbox/staff', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to update notification email: ${response.status}`)
  }

  const remoteResponse = await response.json()

  if (!remoteResponse?.staff || typeof remoteResponse.staff !== 'object') {
    throw new Error('Invalid staff response format: staff is missing')
  }

  try {
    return convertStaff(remoteResponse.staff)
  } catch (transformError) {
    throw new Error(
      `Failed to transform staff: ${transformError instanceof Error ? transformError.message : 'Unknown transformation error'}`,
    )
  }
}

async function putInboxEmailNotifications(
  params: UpdateEmailNotificationsRequest,
): Promise<EmailNotificationsResponse> {
  const response = await fetch('/api/inbox/email-notifications', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Failed to update email notifications: ${response.status}`)
  }
  const remote = (await response.json()) as RemoteEmailNotifications

  if (typeof remote?.email_notifications !== 'boolean') {
    throw new Error('Invalid email notifications response format: email_notifications is not a boolean')
  }

  return { emailNotifications: remote.email_notifications }
}

export function useInboxStaff(brandId: UuidString, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.inboxStaff(brandId),
    queryFn: () => getInboxStaff(brandId),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      console.error('Error fetching staff:', error)
      return failureCount < 3
    },
    enabled: !!brandId && (options?.enabled ?? true),
  })
}

export function useInboxEmailNotifications(brandId: UuidString, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.inboxEmailNotifications(brandId),
    queryFn: () => getInboxEmailNotifications(brandId),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      console.error('Error fetching email notifications:', error)
      return failureCount < 3
    },
    enabled: !!brandId && (options?.enabled ?? true),
  })
}

export function useUpdateStaffNotificationEmail(brandId: UuidString) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: Omit<UpdateStaffNotificationEmailRequest, 'brandId'>) =>
      putInboxStaffNotificationEmail({ ...params, brandId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxStaff(brandId) })
    },
  })
}

export function useUpdateEmailNotifications(brandId: UuidString) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (emailNotifications: boolean) =>
      putInboxEmailNotifications({ brandId, emailNotifications }),
    // Optimistically flip the cached toggle so the UI responds instantly; roll
    // back on error, then re-sync from the server on settle.
    onMutate: async (emailNotifications: boolean) => {
      const key = queryKeys.inboxEmailNotifications(brandId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<EmailNotificationsResponse>(key)
      queryClient.setQueryData<EmailNotificationsResponse>(key, { emailNotifications })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.inboxEmailNotifications(brandId), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxEmailNotifications(brandId) })
    },
  })
}
