'use client'

import clsx from 'clsx'
import { useMemo } from 'react'
import { BottomSheet } from '@airo-ux/pattern-library/surfaces/bottom-sheet'
import TextLockup from '@ux/text-lockup'

import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { logClickEvent } from '@/utils/instrumentation'
import { useCanvasBadgeMap } from './badgeProviders'
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
  const openCanvasLabel = t('builder_commander_open_canvas')
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const openCanvas = useCommanderStore((state) => state.openCanvas)
  const closeMobileChat = useCommanderStore((state) => state.closeMobileChat)
  const badges = useCanvasBadgeMap()
  const isFlagAllowed = useCanvasFlagFilter()

  const items = useMemo(
    () =>
      MOBILE_CANVAS_ORDER.filter((id) => isFlagAllowed(id)).map((id) => ({
        canvasId: id,
        descriptor: CANVAS_REGISTRY[id],
        label: t(CANVAS_REGISTRY[id].labelKey) || CANVAS_REGISTRY[id].fallbackLabel,
      })),
    [t, isFlagAllowed],
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
      aria-label={openCanvasLabel}
      title={<TextLockup size="md" title={openCanvasLabel} />}
      showCloseButton={false}
      className="[&_.airo-surfaces-bottom-sheet__header]:!pt-4 [&_.airo-surfaces-bottom-sheet__header]:!ps-6"
    >
      <div className="flex flex-col gap-0.5 px-3 pb-3 pt-1" data-testid="commander-canvas-sheet">
        {items.map(({ canvasId, descriptor, label }) => {
          const isActive = canvasId === activeCanvasId
          return (
            <button
              key={descriptor.id}
              type="button"
              onClick={() => handleSelect(descriptor.id)}
              data-testid={`commander-canvas-sheet-${descriptor.id}`}
              data-active={isActive ? 'true' : undefined}
              aria-current={isActive ? 'true' : undefined}
              className={clsx(
                'group w-full flex justify-start',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-intents-ux-action-borderColor rounded-lg',
              )}
            >
              <span
                className={clsx(
                  'inline-flex items-center gap-[12px] px-1.5 py-1.5 rounded-lg max-w-full min-w-0',
                  'transition-[background-color,color] duration-200',
                  isActive
                    ? 'bg-intents-ux-boxHighContrast-backgroundColor text-intents-ux-boxHighContrast-foregroundColor'
                    : 'group-hover:bg-intents-ux-actionHovered-backgroundColor',
                )}
              >
                <span className="relative inline-flex shrink-0 items-center justify-center size-2.5">
                  <descriptor.Icon className="size-2.5" />
                  {badges[descriptor.id] && (
                    <span className="pointer-events-none absolute -right-1 -top-1 flex items-center">
                      {badges[descriptor.id]}
                    </span>
                  )}
                </span>
                <span className="truncate text-base">{label}</span>
              </span>
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}
