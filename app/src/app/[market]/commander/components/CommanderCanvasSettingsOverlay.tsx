'use client'

import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import Button from '@ux/button'
import XIcon from '@ux/icon/x'

import { CommanderSettingsCanvasStack } from '@/app/[market]/commander/canvas/CommanderSettingsCanvasStack'
import { CANVAS_REGISTRY, type CanvasId } from '@/app/[market]/commander/canvas/registry'
import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState'
import { ViewMode } from '@/app/[market]/develop/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

const SettingsView = dynamic(
  () => import('@/app/[market]/develop/components/settings/SettingsView'),
  { loading: () => <SettingsLoadingState fullPage /> },
)

const SHEET_TRANSITION = {
  duration: 0.15,
  ease: 'easeOut' as const,
}

const isSettingsCanvasId = (id: CanvasId): boolean =>
  Boolean(CANVAS_REGISTRY[id]?.activation.settingsSection)

export function CommanderCanvasSettingsOverlay() {
  const t = useTranslations()
  const isOpen = useCommanderStore((state) => state.isCanvasSettingsOpen)
  const closeCanvasSettings = useCommanderStore((state) => state.closeCanvasSettings)
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const openCanvasIds = useCommanderStore((state) => state.openCanvasIds)
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const viewMode = useDevelopPageStore((state) => state.viewMode)

  const settingsCanvasIds = useMemo(
    () => openCanvasIds.filter((id) => isSettingsCanvasId(id)),
    [openCanvasIds],
  )
  const isActiveSettings = isSettingsCanvasId(activeCanvasId)
  const isMarketingActive = viewMode === ViewMode.MARKETING

  if (isCanvasTabsEnabled) {
    if (settingsCanvasIds.length === 0) return null
    const isVisible = isActiveSettings && !isMarketingActive
    return (
      <motion.div
        data-testid="commander-canvas-settings-overlay"
        initial={false}
        animate={{ opacity: isVisible ? 1 : 0 }}
        transition={SHEET_TRANSITION}
        aria-hidden={!isVisible}
        className={clsx(
          'absolute top-0 bottom-0 right-1 left-1 flex flex-col p-2.5 rounded-t-lg overflow-hidden shadow-lg bg-intents-ux-box-backgroundColor',
          isVisible ? 'pointer-events-auto' : 'pointer-events-none',
        )}
      >
        <div className="flex-1 min-h-0 overflow-hidden pt-1.5">
          <CommanderSettingsCanvasStack
            openCanvasIds={settingsCanvasIds}
            activeCanvasId={activeCanvasId}
          />
        </div>
      </motion.div>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && !isMarketingActive && (
        <motion.div
          data-testid="commander-canvas-settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={SHEET_TRANSITION}
          className="absolute top-0 bottom-0 right-1 left-1 flex flex-col px-2.5 rounded-t-lg overflow-hidden shadow-lg bg-intents-ux-box-backgroundColor"
        >
          <div className="flex items-center justify-end py-1.5 shrink-0">
            <Button
              data-testid="commander-canvas-settings-close"
              design="tertiary"
              size="sm"
              icon={<XIcon />}
              aria-label={t('builder_common_close')}
              onClick={closeCanvasSettings}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SettingsView />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
