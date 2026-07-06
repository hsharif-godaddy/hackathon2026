'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { ImmersiveHeader } from './ImmersiveHeader'

const IMMERSIVE_TRANSITION = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const }

interface ImmersiveLayoutProps {
  isMobile: boolean
  chatPaneNode: ReactNode
  /**
   * The surface docked beside the chat. When present the chat narrows to a left
   * dock and this panel fills the rest of the row; when absent the chat is a
   * full-width centered column. The caller decides what (if anything) to pin —
   * the immersive layout itself is feature-agnostic.
   */
  pinnedPanelNode?: ReactNode
}

/**
 * Immersive layout (AIROBUILD-3095) — a dedicated `BuilderLayout` that takes over the
 * full builder chrome for a focused, chat-led experience, independent of the
 * Develop/Commander builders. On reveal the page swaps to one of those builders.
 *
 * Structurally feature-agnostic: it owns only the chat-vs-panel geometry. Whether a
 * panel is pinned (and what it is) is the caller's decision, passed via `pinnedPanelNode`:
 * - no panel: a centered, large chat column — all other chrome hidden.
 * - panel: the chat docks left and `pinnedPanelNode` fills the right.
 *
 * The design-kit guided flow is the first consumer (its wizard is the pinned panel), but
 * nothing here knows about the design kit.
 */
export function ImmersiveLayout({
  isMobile,
  chatPaneNode,
  pinnedPanelNode,
}: ImmersiveLayoutProps): ReactNode {
  const chatPaneWidth: number = useDevelopPageStore((state) => state.chatPaneWidth)
  const chatDockedLeft: boolean = pinnedPanelNode != null

  if (isMobile) {
    // Mobile can't show chat + panel side by side: with a pinned panel it fills the
    // screen; otherwise the chat does.
    return (
      <>
        <ImmersiveHeader />
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {chatDockedLeft ? pinnedPanelNode : <div className="h-full w-full">{chatPaneNode}</div>}
        </div>
      </>
    )
  }

  return (
    <>
      <ImmersiveHeader />
      <div className="relative h-full w-full overflow-hidden">
        {/* Chat: full-width centered column with no pinned panel; narrows to a left
            dock once a panel is pinned so it takes the rest of the row. */}
        <motion.div
          className="absolute top-0 start-0 bottom-0 isolate"
          animate={{ width: chatDockedLeft ? chatPaneWidth : '100%' }}
          transition={IMMERSIVE_TRANSITION}
        >
          <div className={cn('h-full w-full', !chatDockedLeft && 'mx-auto max-w-3xl', chatDockedLeft && 'px-3')}>
            {chatPaneNode}
          </div>
        </motion.div>

        {/* Pinned panel: off-screen with no panel (chat is full-width); animates in
            beside the docked chat once pinned. */}
        <motion.div
          className="absolute top-0 end-0 bottom-0 flex flex-col"
          initial={false}
          animate={{ insetInlineStart: chatDockedLeft ? chatPaneWidth + 16 : '100%' }}
          transition={IMMERSIVE_TRANSITION}
        >
          {chatDockedLeft && pinnedPanelNode}
        </motion.div>
      </div>
    </>
  )
}
