'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

import { DesignKitChatHeader } from '@/app/[market]/develop/components/preview/design-kit-wizard/DesignKitChatHeader'
import { DesignKitWizard } from '@/app/[market]/develop/components/preview/design-kit-wizard/DesignKitWizard'
import { cn } from '@/lib/utils'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { WizardPhase } from '@/stores/useWizardStore'

const IMMERSIVE_TRANSITION = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const }

interface ImmersiveDesignKitLayoutProps {
  appId: string
  isMobile: boolean
  chatPaneNode: ReactNode
  wizardPhase: WizardPhase | undefined
}

/**
 * Design-kit immersive takeover (AIROBUILD-3095) — a dedicated `BuilderLayout` used
 * while the guided flow runs (gathering → brand → website), independent of the
 * Develop/Commander builders. On reveal the page swaps to one of those builders.
 *
 * - `gathering`: a centered, large chat column (replicating the non-commander flow) —
 *   all other chrome hidden.
 * - `brand` / `website`: the chat docks left and the `DesignKitWizard` panel
 *   ("Building Your Brand" / "Building your website") fills the right.
 */
export function ImmersiveDesignKitLayout({
  appId,
  isMobile,
  chatPaneNode,
  wizardPhase,
}: ImmersiveDesignKitLayoutProps): ReactNode {
  const chatPaneWidth: number = useDevelopPageStore((state) => state.chatPaneWidth)
  const chatDockedLeft: boolean = wizardPhase === 'brand' || wizardPhase === 'website'

  if (isMobile) {
    // Mobile can't show chat + panel side by side: gathering shows the chat;
    // brand/website shows the build-progress panel full-screen.
    return (
      <>
        <DesignKitChatHeader />
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {chatDockedLeft ? <DesignKitWizard appId={appId} /> : <div className="h-full w-full">{chatPaneNode}</div>}
        </div>
      </>
    )
  }

  return (
    <>
      <DesignKitChatHeader />
      <div className="relative h-full w-full overflow-hidden">
        {/* Chat: full-width centered column while gathering; narrows to a left dock
            once a vibe is chosen so the wizard panel takes the rest of the row. */}
        <motion.div
          className="absolute top-0 start-0 bottom-0 isolate"
          animate={{ width: chatDockedLeft ? chatPaneWidth : '100%' }}
          transition={IMMERSIVE_TRANSITION}
        >
          <div className={cn('h-full w-full', !chatDockedLeft && 'mx-auto max-w-3xl', chatDockedLeft && 'px-3')}>
            {chatPaneNode}
          </div>
        </motion.div>

        {/* Wizard panel: off-screen while gathering (chat is full-width); animates in
            beside the docked chat for brand/website. */}
        <motion.div
          className="absolute top-0 end-0 bottom-0 flex flex-col"
          initial={false}
          animate={{ insetInlineStart: chatDockedLeft ? chatPaneWidth + 16 : '100%' }}
          transition={IMMERSIVE_TRANSITION}
        >
          <DesignKitWizard appId={appId} />
        </motion.div>
      </div>
    </>
  )
}
