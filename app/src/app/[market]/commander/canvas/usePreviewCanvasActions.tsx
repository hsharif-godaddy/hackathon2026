'use client'

import { type ReactNode,useMemo } from 'react'
import ClickIcon from '@ux/icon/click'
import DesktopIcon from '@ux/icon/desktop'
import HistoryIcon from '@ux/icon/history'
import MobilePhoneIcon from '@ux/icon/mobile-phone'
import RefreshIcon from '@ux/icon/refresh'
import SelectIcon from '@ux/icon/select'
import TabletIcon from '@ux/icon/tablet'
import WindowNewIcon from '@ux/icon/window-new'

import {
  type CanvasActionItem,
  CanvasActionItemType,
} from '@/app/[market]/commander/canvas/actions'
import { useCommanderCanvasActionContext } from '@/app/[market]/commander/canvas/CommanderCanvasActionContext'
import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { ChatTab, PreviewViewMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { RedoIcon, UndoIcon } from '@/components/icons/UndoRedoIcons'
import { useRedoAction } from '@/hooks/useRedoAction'
import { useTranslations } from '@/hooks/useTranslations'
import { useUndoAction } from '@/hooks/useUndoAction'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'

const VIEWPORT_ITEMS = [
  { value: PreviewViewMode.DESKTOP, icon: <DesktopIcon className="size-2.5" />, labelKey: 'builder_analytics_desktop_laptop' },
  { value: PreviewViewMode.TABLET, icon: <TabletIcon className="size-2.5" />, labelKey: 'builder_analytics_tablet' },
  { value: PreviewViewMode.MOBILE, icon: <MobilePhoneIcon className="size-2.5" />, labelKey: 'builder_analytics_mobile' },
] as const

function getViewportIcon(mode: PreviewViewMode): ReactNode {
  if (mode === PreviewViewMode.MOBILE) return <MobilePhoneIcon className="size-2.5" />
  if (mode === PreviewViewMode.TABLET) return <TabletIcon className="size-2.5" />
  return <DesktopIcon className="size-2.5" />
}

export function usePreviewCanvasActions(): CanvasActionItem[] {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const viewMode = useDevelopPageStore((state) => state.viewMode)
  const handleViewModeChange = useDevelopPageStore((state) => state.handleViewModeChange)
  const hasUnsavedChanges = useDevelopPageStore((state) => state.hasUnsavedChanges)
  const isAnnotationActive = useDevelopPageStore((state) => state.isAnnotationModeEnabled)
  const toggleAnnotationMode = useDevelopPageStore((state) => state.toggleAnnotationMode)
  const previewViewMode = useDevelopPageStore((state) => state.previewViewMode)
  const setPreviewViewMode = useDevelopPageStore((state) => state.setPreviewViewMode)
  const isVersionHistoryOpen = useDevelopPageStore((state) => state.isVersionHistoryOpen)
  const isMobile = useDevelopPageStore((state) => state.isMobile)
  const setActiveCanvas = useCommanderStore((state) => state.setActiveCanvas)
  const isCanvasTabsEnabled = useCommanderCanvasTabsEnabled()
  const previewUrl = useServerPollingStore((state) =>
    appId ? state.getServerState(appId)?.url ?? null : null,
  )
  const { onPreviewRefresh } = useCommanderCanvasActionContext()
  const setActiveChatTab = useDevelopPageStore((state) => state.setActiveChatTab)
  const undo = useUndoAction()
  const redo = useRedoAction()

  const isEditMode = viewMode === ViewMode.EDIT

  return useMemo<CanvasActionItem[]>(() => {
    // Annotation is a sub-mode of edit: viewMode stays EDIT while annotating.
    // Edit remains in primary active (purple) the whole time; Annotate shows a
    // secondary active state (control + aria-pressed) when both are on.
    const editAction: CanvasActionItem = {
      type: CanvasActionItemType.Button,
      id: 'edit',
      icon: <ClickIcon className="size-2.5" />,
      label: t('builder_chat_toolbar_button_edit'),
      active: isEditMode,
      aiStyle: isEditMode,
      onTrigger: () => {
        handleViewModeChange(isEditMode ? ViewMode.PREVIEW : ViewMode.EDIT, hasUnsavedChanges)
        if (isCanvasTabsEnabled) setActiveCanvas(CanvasId.Preview)
      },
    }

    if (isEditMode) {
      return [
        editAction,
        {
          type: CanvasActionItemType.Button,
          id: 'select',
          icon: <SelectIcon className="size-2.5" />,
          label: t('builder_commander_chat_row_annotation'),
          active: isAnnotationActive,
          onTrigger: () => {
            toggleAnnotationMode()
            if (isCanvasTabsEnabled) setActiveCanvas(CanvasId.Preview)
          },
        },
        { type: CanvasActionItemType.Separator },
        {
          type: CanvasActionItemType.Button,
          id: 'undo',
          icon: <UndoIcon className="size-2.5" />,
          label: t('builder_common_undo'),
          labelHidden: true,
          disabled: undo.isLocked,
          onTrigger: undo.triggerUndo,
        },
        {
          type: CanvasActionItemType.Button,
          id: 'redo',
          icon: <RedoIcon className="size-2.5" />,
          label: t('builder_header_redo'),
          labelHidden: true,
          disabled: redo.isLocked,
          onTrigger: redo.triggerRedo,
        },
      ]
    }

    const items: CanvasActionItem[] = [editAction, { type: CanvasActionItemType.Separator }]

    if (onPreviewRefresh) {
      items.push({
        type: CanvasActionItemType.Button,
        id: 'refresh',
        icon: <RefreshIcon className="size-2.5" />,
        label: t('builder_preview_button_refresh'),
        labelHidden: true,
        disabled: isVersionHistoryOpen,
        onTrigger: onPreviewRefresh,
      })
    }

    items.push({
      type: CanvasActionItemType.Menu,
      id: 'device',
      icon: getViewportIcon(previewViewMode),
      label: t('builder_preview_button_device'),
      labelHidden: true,
      options: VIEWPORT_ITEMS.map((item) => ({
        id: item.value,
        label: t(item.labelKey),
        icon: item.icon,
        active: previewViewMode === item.value,
        onSelect: () => setPreviewViewMode(item.value),
      })),
    })

    if (previewUrl) {
      items.push({
        type: CanvasActionItemType.Button,
        id: 'open-external',
        icon: <WindowNewIcon className="size-2.5" />,
        label: t('builder_preview_open_new_tab'),
        labelHidden: true,
        onTrigger: () => window.open(previewUrl, '_blank', 'noopener,noreferrer'),
      })
    }

    if (isMobile) {
      items.push({
        type: CanvasActionItemType.Button,
        id: 'history',
        icon: <HistoryIcon className="size-2.5" />,
        label: t('builder_chat_toolbar_button_history'),
        labelHidden: true,
        onTrigger: () => setActiveChatTab(ChatTab.HISTORY),
      })
    }

    return items
  }, [
    t,
    isEditMode,
    isAnnotationActive,
    handleViewModeChange,
    hasUnsavedChanges,
    isCanvasTabsEnabled,
    setActiveCanvas,
    toggleAnnotationMode,
    undo.isLocked,
    undo.triggerUndo,
    redo.isLocked,
    redo.triggerRedo,
    previewViewMode,
    setPreviewViewMode,
    onPreviewRefresh,
    isVersionHistoryOpen,
    previewUrl,
    isMobile,
    setActiveChatTab,
  ])
}
