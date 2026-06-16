'use client'

import { useEffect, useRef } from 'react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import { logger } from '@/lib/request-context'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { CANVAS_REGISTRY, type CanvasId, PINNED_CANVAS_ID } from './registry'
import { useCanvasFlagFilter } from './useCanvasFlagFilter'

// Preview canvas covers both PREVIEW and EDIT — EDIT is an inline edit layer on the
// live preview, so re-activating Preview must not clobber a current EDIT viewMode.
const PREVIEW_CANVAS_VIEW_MODES = new Set<ViewMode>([ViewMode.PREVIEW, ViewMode.EDIT])

export function useCanvasSync(): void {
  const isEnabled = useCommanderCanvasTabsEnabled()
  const activeCanvasId = useCommanderStore((state) => state.activeCanvasId)
  const isFlagAllowed = useCanvasFlagFilter()
  const lastAppliedRef = useRef<CanvasId | null>(null)

  useEffect(() => {
    if (!isEnabled) {
      lastAppliedRef.current = null
      return
    }
    // The active canvas can be flag-gated-off (e.g. persisted Brand with brandbook flag off)
    // — CanvasTabs filters it out of the strip but the store still holds it. Force-resync to
    // PINNED so the rendered canvas matches what the user can see/select.
    if (!isFlagAllowed(activeCanvasId)) {
      if (activeCanvasId !== PINNED_CANVAS_ID) {
        useCommanderStore.getState().setActiveCanvas(PINNED_CANVAS_ID)
      }
      return
    }
    if (lastAppliedRef.current === activeCanvasId) return
    const descriptor = CANVAS_REGISTRY[activeCanvasId as CanvasId]
    if (!descriptor) {
      logger.warn('commander.canvasSync.unknownCanvas', { activeCanvasId })
      return
    }
    const previousApplied = lastAppliedRef.current

    const commander = useCommanderStore.getState()
    const develop = useDevelopPageStore.getState()
    const { activation } = descriptor

    if (activation.settingsSection) {
      lastAppliedRef.current = activeCanvasId
      develop.setActiveSettingsSection(activation.settingsSection)
      if (!commander.isCanvasSettingsOpen) commander.openCanvasSettings()
    } else if (activation.viewMode) {
      const isPreviewCanvas = activation.viewMode === ViewMode.PREVIEW
      const alreadyInPreviewSubMode = PREVIEW_CANVAS_VIEW_MODES.has(develop.viewMode)
      if (isPreviewCanvas && alreadyInPreviewSubMode) {
        lastAppliedRef.current = activeCanvasId
        if (commander.isCanvasSettingsOpen) commander.closeCanvasSettings()
        return
      }
      if (commander.isCanvasSettingsOpen) commander.closeCanvasSettings()
      develop.handleViewModeChange(activation.viewMode, develop.hasUnsavedChanges)

      // Roll back the optimistic activeCanvasId if the user cancelled the unsaved-changes
      // confirm in handleViewModeChange (otherwise the tab strip lies about what's active).
      // First-activation case: previousApplied is null, fall back to PINNED.
      const finalViewMode = useDevelopPageStore.getState().viewMode
      const expectedModes = isPreviewCanvas ? PREVIEW_CANVAS_VIEW_MODES : new Set([activation.viewMode])
      if (!expectedModes.has(finalViewMode)) {
        const fallback = previousApplied ?? PINNED_CANVAS_ID
        if (fallback !== activeCanvasId) {
          useCommanderStore.getState().setActiveCanvas(fallback)
        }
        return
      }
      lastAppliedRef.current = activeCanvasId
    }
  }, [isEnabled, activeCanvasId, isFlagAllowed])
}
