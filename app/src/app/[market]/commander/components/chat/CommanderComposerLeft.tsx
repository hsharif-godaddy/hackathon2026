'use client'

import { useEffect, useMemo, useRef } from 'react'
import Button from '@ux/button'
import ClickIcon from '@ux/icon/click'
import SelectIcon from '@ux/icon/select'
import WandIcon from '@ux/icon/wand'

import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { COMMANDER_SECONDARY_ACTIVE_BUTTON_BORDER_CLASS } from '@/app/[market]/commander/components/commanderSurface'
import { ViewMode } from '@/app/[market]/develop/components/types'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import {
  useCommanderActionsBarEnabled,
  useCommanderCanvasTabsEnabled,
  useCommanderStore,
} from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation'

interface CommanderComposerLeftProps {
  appId: string | null
}

export default function CommanderComposerLeft({ appId }: CommanderComposerLeftProps) {
  const t = useTranslations()
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])

  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isAnnotationActive = useDevelopPageStore((state) => state.isAnnotationModeEnabled)
  const toggleAnnotationMode = useDevelopPageStore((state) => state.toggleAnnotationMode)
  const isCommandPaletteEnabled = useSwitchboard('appbuilder-commander-command-palette') === true
  const isAnnotationEnabled = useSwitchboard('appbuilder-commander-annotation') === true
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const isActionsBarEnabled = useCommanderActionsBarEnabled()
  const setActiveCanvas = useCommanderStore((state) => state.setActiveCanvas)

  const isEditActive = viewMode === ViewMode.EDIT

  const annotationImpressionFiredRef = useRef<boolean>(false)
  useEffect(() => {
    if (!isAnnotationEnabled || annotationImpressionFiredRef.current) return
    annotationImpressionFiredRef.current = true
    logImpressionEvent('commander.composer.annotation_mode', clickContext)()
  }, [isAnnotationEnabled, clickContext])

  const handlePaletteClick = () => {
    logClickEvent('commander.composer.command_palette', clickContext)()
  }

  const handleEditClick = () => {
    logClickEvent('commander.composer.edit_mode', clickContext)()
    handleViewModeChange(isEditActive ? ViewMode.PREVIEW : ViewMode.EDIT, hasUnsavedChanges)
    if (isCanvasTabsEnabled) setActiveCanvas(CanvasId.Preview)
  }

  const handleAnnotationClick = () => {
    logClickEvent('commander.composer.annotation_mode', clickContext)()
    toggleAnnotationMode()
    if (isCanvasTabsEnabled) setActiveCanvas(CanvasId.Preview)
  }

  return (
    <div className="flex items-center gap-0.5">
      {isCommandPaletteEnabled && (
        <>
          <Button
            design="primary"
            size="sm"
            icon={<WandIcon className="size-2.5" />}
            onClick={handlePaletteClick}
            aria-label={t('builder_commander_chat_row_command_palette')}
            data-testid="commander-composer-palette"
            data-eid="commander.composer.command_palette"
            data-partial="componentAiro"
          />

          <span
            aria-hidden="true"
            className="inline-block w-px h-3 bg-intents-ux-box-borderColor mx-0.5"
          />
        </>
      )}

      {!isActionsBarEnabled && (
        <Button
          design={isEditActive ? 'primary' : 'control'}
          size="sm"
          icon={<ClickIcon className="size-2.5" />}
          text={t('builder_chat_toolbar_button_edit')}
          onClick={handleEditClick}
          aria-pressed={isEditActive}
          data-eid="commander.composer.edit_mode"
          data-partial={isEditActive ? 'componentAiro' : ''}
          className="px-1.5!"
        />
      )}

      {isAnnotationEnabled && !isActionsBarEnabled && (
        <Button
          design="control"
          size="sm"
          icon={<SelectIcon className="size-2.5" />}
          onClick={handleAnnotationClick}
          aria-label={t('builder_commander_chat_row_annotation')}
          active={isAnnotationActive}
          data-testid="commander-composer-annotation"
          className={isAnnotationActive ? COMMANDER_SECONDARY_ACTIVE_BUTTON_BORDER_CLASS : undefined}
        />
      )}
    </div>
  )
}
