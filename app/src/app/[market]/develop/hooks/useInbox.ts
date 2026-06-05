import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/lib/inbox/constants/queryKeys'
import { ThreadedMessagePageChildren } from '@/lib/inbox/http/response/core'
import { convertConversation } from '@/lib/inbox/transforms/conversation'
import { convertMessage } from '@/lib/inbox/transforms/message'
import { Conversation } from '@/types/inbox/local/conversation'
import { IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'
import { Message } from '@/types/inbox/local/message'
import { RemoteConversation } from '@/types/inbox/remote/conversation'
import { RemoteMessage } from '@/types/inbox/remote/message'
import { ConversationMessagesRequest, ConversationMessagesResponse, ConversationsRequest, ConversationsResponse } from '@/types/inbox/remote/reamaze'

async function getInboxConversations(params: ConversationsRequest): Promise<ConversationsResponse> {
  if (!params.brandId) {
    throw new Error('Brand ID is required')
  }

  const url = new URL('/api/inbox/conversations', window.location.origin)
  url.searchParams.set('brandId', params.brandId)
  if (params.until) {
    url.searchParams.set('before_timestamp', params.until)
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

  const getUntil = (conversations: Conversation[]) => {
    const lastConversation = conversations[conversations.length - 1]
    let nextUntil = params.until
    if (
      lastConversation &&
      (!params.until || params.until > lastConversation.bumpedAt)
    ) {
      nextUntil = lastConversation.bumpedAt
    }
    return nextUntil
  }

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

  const until = getUntil(conversations)
  const hasMore = remoteResponse.page_count
    ? remoteResponse.page_count > 1
    : conversations.length >= (remoteResponse.page_size || 30)

  return {
    conversations,
    hasMore,
    until,
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
  until?: IsoDateTimeString,
) {
  return useQuery({
    queryKey: queryKeys.inboxConversations(brandId, until),
    queryFn: () => getInboxConversations({ brandId, until }),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      console.error('Error fetching conversations:', error)
      return failureCount < 3
    },
    enabled: !!brandId
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
    staleTime: 1 * 60 * 1000, // 1 minute
    retry: (failureCount, error) => {
      console.error('Error fetching conversation messages by ID:', error)
      return failureCount < 3
    },
    enabled: !!conversationId, // Only run query if conversationId is provided
  })
}