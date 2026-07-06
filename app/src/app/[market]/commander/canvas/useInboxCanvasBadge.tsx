'use client'

import type { ReactElement } from 'react'

import { InboxUnresolvedBadge } from '@/app/[market]/develop/components/layout/InboxUnresolvedBadge'
import { useInboxUnresolvedCount } from '@/app/[market]/develop/hooks/useInbox'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

/**
 * Canvas badge provider for the Inbox tab: renders the unresolved-count badge
 * when the inbox flag is on, a brand is bound, and there is at least one
 * unresolved conversation. Returns null otherwise so the tab shows no badge.
 *
 * The count query is keyed by brand id, so calling this from multiple surfaces
 * (tab, overflow menu, mobile sheet) de-dupes to a single fetch via react-query.
 */
export function useInboxCanvasBadge(): ReactElement | null {
  const isInboxEnabled: boolean = useSwitchboard('app-builder-inbox-button') === true
  const inboxBrandId: string | null = useDevelopPageStore((state) => state.inboxBrandId)
  const { data: unresolvedCount = 0 } = useInboxUnresolvedCount(
    isInboxEnabled && inboxBrandId ? inboxBrandId : undefined,
  )

  if (unresolvedCount <= 0) {
    return null
  }

  return <InboxUnresolvedBadge count={unresolvedCount} />
}
