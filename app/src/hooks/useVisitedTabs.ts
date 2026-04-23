import { useEffect, useState } from 'react'

import { ChatTab } from '@/app/[market]/develop/components/types'

/**
 * Tracks which tabs have been visited at least once.
 * Used for the hybrid lazy-mount pattern: mount on first visit, then CSS-hide
 * to preserve state on subsequent tab switches.
 */
export function useVisitedTabs(activeTab: ChatTab, initialTab: ChatTab = ChatTab.CHAT) {
  const [visitedTabs, setVisitedTabs] = useState(() => new Set<ChatTab>([initialTab]))

  useEffect(function trackVisitedTabs() {
    setVisitedTabs(function addTab(prev) {
      if (prev.has(activeTab)) return prev
      return new Set(prev).add(activeTab)
    })
  }, [activeTab])

  return visitedTabs
}
