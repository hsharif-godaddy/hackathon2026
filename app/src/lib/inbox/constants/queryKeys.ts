import { IntString, IsoDateTimeString, UuidString } from '@/types/inbox/local/core'
import { InboxConversationStatusFilter } from '@/types/inbox/local/inboxConversationStatusFilter'

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
  inboxConversationsByBrand: (brandId: UuidString) =>
    [...queryKeys.all, 'inboxConversations', brandId] as const,
  inboxConversations: (
    brandId: UuidString,
    page?: number,
    filter?: InboxConversationStatusFilter,
  ) =>
    [
      ...queryKeys.all,
      'inboxConversations',
      brandId,
      page,
      filter,
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
  inboxConversationMessagesInfinite: (
    id: IntString,
    brandId: UuidString,
  ) =>
    [
      ...queryKeys.all,
      'inboxConversationMessagesInfinite',
      id,
      brandId,
    ] as const,
  inboxStaff: (brandId: UuidString) =>
    [
      ...queryKeys.all,
      'inboxStaff',
      brandId,
    ] as const,
  inboxEmailNotifications: (brandId: UuidString) =>
    [
      ...queryKeys.all,
      'inboxEmailNotifications',
      brandId,
    ] as const,
  inboxUnreadCount: (brandId: UuidString) =>
    [
      ...queryKeys.all,
      'inboxUnreadCount',
      brandId,
    ] as const,
}