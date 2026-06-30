'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import Button from '@ux/button'
import ConversationsIcon from '@ux/icon/conversations'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { logClickEvent } from '@/utils/instrumentation'
import { COMMANDER_PILL_INNER_SURFACE_CLASS, COMMANDER_PILL_OUTER_SURFACE_CLASS } from './commanderSurface'
import { CommanderCanvasSheet } from '../canvas/CommanderCanvasSheet'
import { CANVAS_REGISTRY } from '../canvas/registry'

export function CommanderMobileBar() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])
  // Canvas switching only takes effect through useCanvasSync, which is gated on this flag —
  // without it, the picker would relabel the pill but never change the view. Hide it then.
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const openMobileChat = useCommanderStore((state) => state.openMobileChat)
  const [sheetOpen, setSheetOpen] = useState(false)

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

  return (
    <>
      <motion.div
        className="absolute bottom-3 left-1/2 z-30"
        initial={{ opacity: 0, y: 10, scale: 0.98, x: '-50%' }}
        animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
        transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className={clsx('rounded-2xl shadow-lg', COMMANDER_PILL_OUTER_SURFACE_CLASS)}>
          <div className={clsx('flex items-center gap-0.5 rounded-lg px-1 py-1', COMMANDER_PILL_INNER_SURFACE_CLASS)}>
            {isCanvasTabsEnabled && (
              <>
                <Button
                  as="select"
                  design="primary"
                  size="sm"
                  icon={<ActiveIcon className="size-2.5" />}
                  text={activeLabel}
                  onClick={handleOpenSheet}
                  data-testid="commander-mobile-canvas-selector"
                />
                <span aria-hidden="true" className="inline-block w-px h-3 bg-intents-ux-box-borderColor mx-0.5 shrink-0" />
              </>
            )}
            <Button
              design="secondary"
              size="sm"
              icon={<ConversationsIcon className="size-2.5" />}
              text={t('builder_chat_toolbar_button_chat')}
              onClick={handleOpenChat}
              data-testid="commander-mobile-chat-button"
            />
          </div>
        </div>
      </motion.div>
      <CommanderCanvasSheet open={sheetOpen} onOpenChange={setSheetOpen} clickContext={clickContext} />
    </>
  )
}
