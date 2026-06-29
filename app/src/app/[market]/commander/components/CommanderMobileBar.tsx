'use client'

import { useMemo, useState } from 'react'
import ChevronDownIcon from '@ux/icon/chevron-down'
import ConversationsIcon from '@ux/icon/conversations'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { logClickEvent } from '@/utils/instrumentation'
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
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
        {isCanvasTabsEnabled && (
          <button
            type="button"
            onClick={handleOpenSheet}
            data-testid="commander-mobile-canvas-selector"
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 shadow-lg bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor"
          >
            <ActiveIcon className="size-2.5" />
            <span className="text-sm font-medium whitespace-nowrap">{activeLabel}</span>
            <ChevronDownIcon className="size-2.5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleOpenChat}
          data-testid="commander-mobile-chat-button"
          className="flex items-center gap-1 rounded-full px-2.5 py-1.5 shadow-lg bg-intents-ux-box-backgroundColor text-intents-ux-box-foregroundColor"
        >
          <ConversationsIcon className="size-2.5" />
          <span className="text-sm font-medium whitespace-nowrap">{t('builder_chat_toolbar_button_chat')}</span>
        </button>
      </div>
      <CommanderCanvasSheet open={sheetOpen} onOpenChange={setSheetOpen} clickContext={clickContext} />
    </>
  )
}
