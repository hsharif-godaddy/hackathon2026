'use client'

import { useMemo } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { logClickEvent } from '@/utils/instrumentation'
import { CanvasMenu } from './CanvasMenu'
import { CanvasTab } from './CanvasTab'
import { CANVAS_OVERFLOW_THRESHOLD, CANVAS_REGISTRY, CanvasId } from './registry'
import { useCanvasFlagFilter } from './useCanvasFlagFilter'

interface CanvasTabsProps {
  clickContext?: { appId: string }
}

export function CanvasTabs({ clickContext }: CanvasTabsProps) {
  const t = useTranslations()
  const openCanvasIds = useCommanderStore((state) => state.openCanvasIds)
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const setActiveCanvas = useCommanderStore((state) => state.setActiveCanvas)
  const closeCanvas = useCommanderStore((state) => state.closeCanvas)

  const collapseLabels = openCanvasIds.length > CANVAS_OVERFLOW_THRESHOLD

  const isFlagAllowed = useCanvasFlagFilter()
  const tabs = useMemo(
    () =>
      openCanvasIds
        .map((id) => CANVAS_REGISTRY[id])
        .filter((d): d is NonNullable<typeof d> => Boolean(d) && isFlagAllowed(d.id)),
    [openCanvasIds, isFlagAllowed],
  )

  return (
    <div className="flex items-center gap-0.5" data-testid="commander-canvas-tabs">
      {tabs.map((descriptor) => {
        const isActive = descriptor.id === activeCanvasId
        const translatedLabel = descriptor.labelKey ? t(descriptor.labelKey) : null
        const label = translatedLabel && translatedLabel !== descriptor.labelKey
          ? translatedLabel
          : descriptor.fallbackLabel
        const closeLabel = collapseLabels
          ? t('builder_commander_canvas_tab_close_named', { name: label })
          : t('builder_common_close')
        return (
          <CanvasTab
            key={descriptor.id}
            canvasId={descriptor.id}
            icon={<descriptor.Icon className="size-2.5" />}
            label={label}
            active={isActive}
            dismissible={descriptor.dismissible}
            collapseLabel={collapseLabels}
            closeLabel={closeLabel}
            testId={`commander-canvas-tab-${descriptor.id}`}
            onActivate={() => {
              if (!isActive) {
                logClickEvent('commander.canvas_tab.activate', { ...clickContext, canvasId: descriptor.id })()
              }
              setActiveCanvas(descriptor.id as CanvasId)
            }}
            onClose={
              descriptor.dismissible
                ? () => {
                    logClickEvent('commander.canvas_tab.close', { ...clickContext, canvasId: descriptor.id })()
                    closeCanvas(descriptor.id as CanvasId)
                  }
                : undefined
            }
          />
        )
      })}
      <CanvasMenu clickContext={clickContext} />
    </div>
  )
}
