import { IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'

export const queryKeys = {
  all: ['reamaze'] as const,
  inboxConversation: (
    brandId: UuidString,
    id: IntString,
  ) =>
    [
      ...queryKeys.all,
      'inboxConversation',
      id,
      brandId,
    ] as const,
  inboxConversations: (
    brandId: UuidString,
    page?: number,
  ) =>
    [
      ...queryKeys.all,
      'inboxConversations',
      brandId,
      page,
    ] as const,
  inboxConversationMessages: (
    id: IntString,
    brandId: UuidString,
    until?: IsoDateTimeString,
    childrenFetchData?: {
      until: IsoDateTimeString | undefined
      parentMessageId: IntString | undefined
    },
  ) =>
    [
      ...queryKeys.all,
      'inboxConversationMessages',
      id,
      brandId,
      until,
      childrenFetchData,
    ] as const,
}