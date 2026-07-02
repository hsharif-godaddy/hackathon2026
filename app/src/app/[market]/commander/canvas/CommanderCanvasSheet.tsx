'use client'

import clsx from 'clsx'
import { useMemo } from 'react'
import { BottomSheet } from '@airo-ux/pattern-library/surfaces/bottom-sheet'

import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { logClickEvent } from '@/utils/instrumentation'
import { CANVAS_MENU_ORDER, CANVAS_REGISTRY, type CanvasId, PINNED_CANVAS_ID } from './registry'
import { useCanvasFlagFilter } from './useCanvasFlagFilter'

interface CommanderCanvasSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clickContext?: { appId: string }
}

const MOBILE_CANVAS_ORDER: readonly CanvasId[] = [PINNED_CANVAS_ID, ...CANVAS_MENU_ORDER]

export function CommanderCanvasSheet({ open, onOpenChange, clickContext }: CommanderCanvasSheetProps) {
  const t = useTranslations()
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const openCanvas = useCommanderStore((state) => state.openCanvas)
  const closeMobileChat = useCommanderStore((state) => state.closeMobileChat)
  const isFlagAllowed = useCanvasFlagFilter()

  const items = useMemo(
    () =>
      MOBILE_CANVAS_ORDER.filter((id) => id !== activeCanvasId && isFlagAllowed(id)).map((id) => ({
        descriptor: CANVAS_REGISTRY[id],
        label: t(CANVAS_REGISTRY[id].labelKey) || CANVAS_REGISTRY[id].fallbackLabel,
      })),
    [t, activeCanvasId, isFlagAllowed],
  )

  const handleSelect = (canvasId: CanvasId): void => {
    logClickEvent('commander.mobile_canvas_sheet.select', { ...clickContext, canvasId })()
    closeMobileChat()
    openCanvas(canvasId)
    onOpenChange(false)
  }

  return (
    <BottomSheet
      show={open}
      onClose={() => onOpenChange(false)}
      title={t('builder_commander_open_canvas')}
      showCloseButton={false}
      style={{ maxBlockSize: '50dvh' }}
    >
      <div className="flex flex-col px-1" data-testid="commander-canvas-sheet">
        {items.map(({ descriptor, label }) => (
          <button
            key={descriptor.id}
            type="button"
            onClick={() => handleSelect(descriptor.id)}
            data-testid={`commander-canvas-sheet-${descriptor.id}`}
            className={clsx(
              'w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-left',
              'hover:bg-intents-ux-actionHovered-backgroundColor',
              'focus:outline-none focus-visible:ring-1 focus-visible:ring-intents-ux-action-borderColor',
            )}
          >
            <span className="inline-flex shrink-0 items-center justify-center size-2.5">
              <descriptor.Icon className="size-2.5" />
            </span>
            <span className="flex-1 truncate text-base">{label}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
