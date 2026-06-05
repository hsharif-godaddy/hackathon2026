import { IntString, IsoDateTimeString } from '@/types/inbox/local/core'

export const queryKeys = {
  all: ['reamaze'] as const,
  inboxConversations: (
    brandId: string,
    until?: IsoDateTimeString,
  ) =>
    [
      ...queryKeys.all,
      'inboxConversations',
      brandId,
      until,
    ] as const,
  inboxConversationMessages: (
    id: IntString,
    brandId: string,
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