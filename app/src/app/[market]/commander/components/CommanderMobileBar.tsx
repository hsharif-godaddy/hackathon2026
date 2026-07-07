'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import { type ReactElement, useEffect, useMemo, useState } from 'react'
import Button from '@ux/button'
import ConversationsIcon from '@ux/icon/conversations'

import { type LatestNBAData, useLatestNBAs } from '@/app/[market]/develop/components/chat/useLatestNBAs'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { isInitialBuildComplete, isInitialBuildFunnelActive } from '@/hooks/shared/initialBuildFunnel'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useActiveRunningToolName, useIsLoading } from '@/stores/useStreamingConversationStore'
import { logClickEvent } from '@/utils/instrumentation'
import { COMMANDER_PILL_INNER_SURFACE_CLASS, COMMANDER_PILL_OUTER_SURFACE_CLASS } from './commanderSurface'
import { useCanvasBadgeMap } from '../canvas/badgeProviders'
import { CanvasBadgeDot } from '../canvas/CanvasBadgeDot'
import { CommanderCanvasSheet } from '../canvas/CommanderCanvasSheet'
import { CANVAS_REGISTRY } from '../canvas/registry'

interface CommanderMobileBarProps {
  mobileChatAutoOpenedQuestion: string | null
  onMobileChatAutoOpened: (question: string) => void
}

export function CommanderMobileBar({
  mobileChatAutoOpenedQuestion,
  onMobileChatAutoOpened,
}: CommanderMobileBarProps) {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])
  // Canvas switching only takes effect through useCanvasSync, which is gated on this flag —
  // without it, the picker would relabel the pill but never change the view. Hide it then.
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const openMobileChat = useCommanderStore((state) => state.openMobileChat)
  const [sheetOpen, setSheetOpen] = useState(false)
  const latestNBA: LatestNBAData | null = useLatestNBAs()
  const activeRunningToolName: string | null = useActiveRunningToolName()
  const isLoading: boolean = useIsLoading()
  const isInitialBuildQuestion: boolean = isInitialBuildFunnelActive() && !isInitialBuildComplete()
  const isProcessing: boolean = isLoading || activeRunningToolName !== null
  const latestQuestion: string | undefined = latestNBA?.question
  const showQuestionBadge: boolean =
    latestNBA?.source === 'askQuestion' && isInitialBuildQuestion && !isProcessing

  const badges = useCanvasBadgeMap()
  // The selector shows the active canvas's icon, so surface its own badge there
  // (matching the desktop tab). A badge on any other canvas can't be shown on
  // that icon, so it falls back to a plain dot signalling "unread behind here".
  const activeBadge: ReactElement | null | undefined = badges[activeCanvasId]
  const hasHiddenBadge: boolean = Object.entries(badges).some(
    ([canvasId, node]) => node != null && canvasId !== activeCanvasId,
  )

  const descriptor = CANVAS_REGISTRY[activeCanvasId]
  const ActiveIcon = descriptor.Icon
  const activeLabel = t(descriptor.labelKey) || descriptor.fallbackLabel

  const handleOpenSheet = (): void => {
    logClickEvent('commander.mobile_bar.open_canvas_sheet', clickContext)()
    setSheetOpen(true)
  }

  const handleOpenChat = (): void => {
    logClickEvent('commander.mobile_bar.open_chat', clickContext)()
    openMobileChat()
  }

  useEffect(function openQuestionChat(): void {
    if (!showQuestionBadge || !latestQuestion || mobileChatAutoOpenedQuestion === latestQuestion) return

    onMobileChatAutoOpened(latestQuestion)
    openMobileChat()
  }, [latestQuestion, mobileChatAutoOpenedQuestion, onMobileChatAutoOpened, openMobileChat, showQuestionBadge])

  return (
    <>
      <motion.div
        className="absolute bottom-3 left-1/2"
        initial={{ opacity: 0, y: 10, scale: 0.98, x: '-50%' }}
        animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className={clsx('rounded-2xl shadow-lg', COMMANDER_PILL_OUTER_SURFACE_CLASS)}>
          <div className={clsx('flex items-center gap-0.5 rounded-lg px-1 py-1', COMMANDER_PILL_INNER_SURFACE_CLASS)}>
            {isCanvasTabsEnabled && (
              <>
                <span className="relative inline-flex shrink-0">
                  <Button
                    as="select"
                    design="primary"
                    size="sm"
                    icon={<ActiveIcon className="size-2.5" />}
                    text={activeLabel}
                    onClick={handleOpenSheet}
                    data-testid="commander-mobile-canvas-selector"
                  />
                  {activeBadge ? (
                    <span className="pointer-events-none absolute -right-1 -top-1 flex items-center">
                      {activeBadge}
                    </span>
                  ) : (
                    hasHiddenBadge && <CanvasBadgeDot testId="commander-mobile-canvas-selector-badge" />
                  )}
                </span>
                <span aria-hidden="true" className="inline-block w-px h-3 bg-intents-ux-box-borderColor mx-0.5 shrink-0" />
              </>
            )}
            <span className="relative inline-flex">
              <Button
                design="secondary"
                size="sm"
                icon={<ConversationsIcon className="size-2.5" />}
                text={t('builder_chat_toolbar_button_chat')}
                onClick={handleOpenChat}
                data-testid="commander-mobile-chat-button"
                aria-label={showQuestionBadge ? t('builder_chat_toolbar_button_chat_attention') : undefined}
              />
              {showQuestionBadge && (
                <span
                  className="pointer-events-none absolute -top-[3px] -right-[3px] flex size-1.5 items-center justify-center overflow-visible"
                  aria-hidden="true"
                  data-testid="commander-mobile-chat-question-badge"
                >
                  <span className="absolute inset-0 rounded-full bg-ai animate-commander-chat-badge-pulse" />
                  <span
                    className="relative size-1.5 rounded-full bg-ai"
                    data-testid="commander-mobile-chat-button-badge"
                  />
                </span>
              )}
            </span>
          </div>
        </div>
      </motion.div>
      <CommanderCanvasSheet open={sheetOpen} onOpenChange={setSheetOpen} clickContext={clickContext} />
    </>
  )
}
