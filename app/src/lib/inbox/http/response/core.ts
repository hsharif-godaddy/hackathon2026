import { IntString } from '@/types/inbox/local/core'
import { Message } from '@/types/inbox/local/message'

export type ThreadedMessagePageChildren = Record<
  IntString,
  {
    items: Message[]
    totalCount: number
    hasMore: boolean
    until: string | undefined
  }
>
