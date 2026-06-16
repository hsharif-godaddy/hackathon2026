'use client'

import { useMemo } from 'react'
import Button from '@ux/button'
import ClickIcon from '@ux/icon/click'
import ImageIcon from '@ux/icon/image'
import WandIcon from '@ux/icon/wand'

import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { ChatTab, ViewMode } from '@/app/[market]/develop/components/types'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logClickEvent } from '@/utils/instrumentation'

interface CommanderComposerLeftProps {
  appId: string | null
}

export default function CommanderComposerLeft({ appId }: CommanderComposerLeftProps) {
  const t = useTranslations()
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId])

  const { setActiveChatTab } = useChatTabs()
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isCommandPaletteEnabled = useSwitchboard('appbuilder-commander-command-palette') === true
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const setActiveCanvas = useCommanderStore((state) => state.setActiveCanvas)

  const isEditActive = viewMode === ViewMode.EDIT

  const handlePaletteClick = () => {
    logClickEvent('commander.composer.command_palette', clickContext)()
  }

  const handleEditClick = () => {
    logClickEvent('commander.composer.edit_mode', clickContext)()
    handleViewModeChange(isEditActive ? ViewMode.PREVIEW : ViewMode.EDIT, hasUnsavedChanges)
    if (isCanvasTabsEnabled) setActiveCanvas(CanvasId.Preview)
  }

  const handleImagesClick = () => {
    logClickEvent('commander.composer.media', clickContext)()
    setActiveChatTab(ChatTab.MEDIAS)
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

      <Button
        design="tertiary"
        size="sm"
        icon={<ImageIcon className="size-2.5" />}
        onClick={handleImagesClick}
        aria-label={t('builder_chat_toolbar_button_media')}
        data-eid="commander.composer.media"
      />
    </div>
  )
}
