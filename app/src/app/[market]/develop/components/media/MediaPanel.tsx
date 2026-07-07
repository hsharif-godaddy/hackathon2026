'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ChevronLeftIcon from '@ux/icon/chevron-left'

import { ImageEditorPanel } from '@/app/[market]/develop/components/media/ImageEditorPanel'
import { MediaSlotDetail } from '@/app/[market]/develop/components/media/MediaSlotDetail'
import { MediaSlotsGrid } from '@/app/[market]/develop/components/media/MediaSlotsGrid'
import { SourceImagesLibrary } from '@/app/[market]/develop/components/media/SourceImagesLibrary'
import { ChatTab, MobileMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useTranslations } from '@/hooks/useTranslations'
import { DEFAULT_CHAT_PANE_WIDTH, useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import type { BusMediaSlotForkContext } from '@/utils/eventBus'
import {
  clearMediaSlotForkContext,
  loadMediaSlotForkContext,
  loadMediaSlotOccurrenceIndex,
  parseCollectionOccurrenceIndex,
} from '@/utils/media-slot-fork'
import { postMessageToIframe } from '@/utils/postMessage'

// Wide enough to comfortably show the image editor canvas + toolbars
const EDITOR_CHAT_PANE_WIDTH = 616

type SlotDetailEntry = 'grid' | 'external' | null

export default function MediaPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const [activeSlotName, setActiveSlotName] = useState<string | null>(null)
  const [slotDetailEntry, setSlotDetailEntry] = useState<SlotDetailEntry>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null)
  const [thumbnailBustKey, setThumbnailBustKey] = useState(0)
  const [activeForkContext, setActiveForkContext] = useState<BusMediaSlotForkContext | null>(null)
  const [activeOccurrenceIndex, setActiveOccurrenceIndex] = useState<number | null>(null)
  const [suppressPreviewScroll, setSuppressPreviewScroll] = useState(false)
  const [isCarouselSlotReplace, setIsCarouselSlotReplace] = useState(false)
  const priorPaneWidthRef = useRef<number>(DEFAULT_CHAT_PANE_WIDTH)
  const prevActiveSlotNameRef = useRef<string | null>(null)
  const prevMobileModeRef = useRef<MobileMode>(MobileMode.TOOLS)
  const prevViewModeRef = useRef<ViewMode>(ViewMode.PREVIEW)

  const panelSlotName = useMediaSlotDialogStore((state) => state.panelSlotName)
  const clearPanelSlot = useMediaSlotDialogStore((state) => state.clearPanelSlot)
  const clearPanelSlotForkContext = useMediaSlotDialogStore((state) => state.clearPanelSlotForkContext)
  const mediaReturnTab = useMediaSlotDialogStore((state) => state.mediaReturnTab)
  const mediaReturnMobileMode = useMediaSlotDialogStore((state) => state.mediaReturnMobileMode)
  const clearMediaReturnState = useMediaSlotDialogStore((state) => state.clearMediaReturnState)
  const openEditorForSlot = useMediaSlotDialogStore((state) => state.openEditorForSlot)
  const clearEditorSlot = useMediaSlotDialogStore((state) => state.clearEditorSlot)
  const setCurrentSlotName = useMediaSlotDialogStore((state) => state.setCurrentSlotName)

  useEffect(function syncCurrentSlotNameToStore() {
    setCurrentSlotName(activeSlotName)
    return () => setCurrentSlotName(null)
  }, [activeSlotName, setCurrentSlotName])

  useEffect(function endCarouselSlotEditWhenLeavingDetail() {
    const previousSlotName = prevActiveSlotNameRef.current
    prevActiveSlotNameRef.current = activeSlotName

    if (previousSlotName === null || activeSlotName !== null) {
      return
    }

    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
    if (iframe) {
      postMessageToIframe(iframe, { type: 'CAROUSEL_SLOT_EDIT', active: false })
    }
  }, [activeSlotName])

  // Safety net: MediaPanel unmount (e.g., builder-side navigation) doesn't run the transition-based effect above. Always signal exit so the iframe never gets stuck with slot-edit active + timers paused.
  useEffect(function endCarouselSlotEditOnUnmount() {
    return () => {
      const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
      if (iframe) {
        postMessageToIframe(iframe, { type: 'CAROUSEL_SLOT_EDIT', active: false })
      }
    }
  }, [])

  const activeChatTab = useDevelopPageStore((state) => state.activeChatTab)
  const mobileMode = useDevelopPageStore((state) => state.mobileMode)
  const viewMode = useDevelopPageStore((state) => state.viewMode)

  const { setActiveChatTab } = useChatTabs()

  const { manifest, slotNames, isLoading, error, refetch } = useMediaManifest({
    appId: appId || null
  })

  // Respond to external navigation requests (e.g., from preview "Swap Image" or "Modify").
  // Also atomically handles editor auto-open: if openEditorForSlot matches the incoming
  // slot, open the editor in the same render cycle to avoid a two-effect race condition.
  useEffect(function handleExternalNavigation() {
    if (!panelSlotName) return
    if (panelSlotName === '__GRID__') {
      setActiveSlotName(null)
      setSlotDetailEntry(null)
    } else {
      const store = useMediaSlotDialogStore.getState()
      const forkContext = store.panelSlotForkContext ?? loadMediaSlotForkContext(panelSlotName)
      const occurrenceIndex = store.panelSlotOccurrenceIndex
        ?? loadMediaSlotOccurrenceIndex(panelSlotName)
        ?? (forkContext?.selector ? parseCollectionOccurrenceIndex(forkContext.selector) : null)
      setActiveSlotName(panelSlotName)
      setSlotDetailEntry('external')
      setActiveForkContext(forkContext)
      setActiveOccurrenceIndex(occurrenceIndex)
      setSuppressPreviewScroll(store.panelSkipPreviewScroll)
      if (store.panelCarouselSlotEdit) {
        setIsCarouselSlotReplace(true)
      }
      if (openEditorForSlot === panelSlotName) {
        if (!isEditorOpen) {
          priorPaneWidthRef.current = useDevelopPageStore.getState().chatPaneWidth
          useDevelopPageStore.getState().setChatPaneWidth(EDITOR_CHAT_PANE_WIDTH)
        }
        setIsEditorOpen(true)
        clearEditorSlot()
      }
    }
    clearPanelSlot()
    clearPanelSlotForkContext()
  }, [panelSlotName, openEditorForSlot, isEditorOpen, clearPanelSlot, clearEditorSlot, clearPanelSlotForkContext])

  // Restore pane width when user navigates away from the Media tab while editor is open
  useEffect(function restorePaneWidthOnTabChange() {
    if (isEditorOpen && activeChatTab !== ChatTab.MEDIAS) {
      useDevelopPageStore.getState().setChatPaneWidth(priorPaneWidthRef.current)
      setIsEditorOpen(false)
      setEditorImageUrl(null)
    }
  }, [activeChatTab, isEditorOpen])

  // Drop a stale return tab if the user leaves the Media tab any way other
  // than the grid back button — otherwise a later manual visit shows a
  // breadcrumb pointing somewhere they no longer came from.
  useEffect(function clearStaleMediaReturnTab() {
    if (activeChatTab !== ChatTab.MEDIAS && mediaReturnTab != null) {
      clearMediaReturnState()
    }
  }, [activeChatTab, mediaReturnTab, clearMediaReturnState])

  const handleSelectSlot = useCallback((slotName: string) => {
    setSuppressPreviewScroll(false)
    clearMediaReturnState()
    setActiveForkContext(null)
    setActiveOccurrenceIndex(null)
    setActiveSlotName(slotName)
    setSlotDetailEntry('grid')
  }, [clearMediaReturnState])

  const handleBack = useCallback(() => {
    if (slotDetailEntry === 'external' && mediaReturnTab != null) {
      setActiveChatTab(mediaReturnTab)
      if (mediaReturnMobileMode != null) {
        useDevelopPageStore.getState().handleMobileModeChange(mediaReturnMobileMode)
      }
    }
    if (slotDetailEntry === 'external') {
      clearMediaReturnState()
      if (activeSlotName) {
        clearMediaSlotForkContext(activeSlotName)
      }
    }
    setActiveForkContext(null)
    setActiveOccurrenceIndex(null)
    setIsCarouselSlotReplace(false)
    setActiveSlotName(null)
    setSlotDetailEntry(null)
    setThumbnailBustKey((k) => k + 1)
    void refetch()
  }, [
    slotDetailEntry,
    activeSlotName,
    mediaReturnTab,
    mediaReturnMobileMode,
    setActiveChatTab,
    clearMediaReturnState,
    refetch,
  ])

  useEffect(function exitCarouselReplaceOnPreviewSwitch() {
    const switchedToMobilePreview =
      prevMobileModeRef.current !== MobileMode.PREVIEW &&
      mobileMode === MobileMode.PREVIEW
    const switchedToDesktopPreview =
      prevViewModeRef.current === ViewMode.EDIT &&
      viewMode === ViewMode.PREVIEW
    prevMobileModeRef.current = mobileMode
    prevViewModeRef.current = viewMode

    if (
      activeSlotName !== null &&
      slotDetailEntry === 'external' &&
      isCarouselSlotReplace &&
      (switchedToMobilePreview || switchedToDesktopPreview)
    ) {
      handleBack()
    }
  }, [
    activeSlotName,
    slotDetailEntry,
    isCarouselSlotReplace,
    mobileMode,
    viewMode,
    handleBack,
  ])

  const handleOpenEditor = useCallback((imageUrl: string) => {
    if (!isEditorOpen) {
      priorPaneWidthRef.current = useDevelopPageStore.getState().chatPaneWidth
      useDevelopPageStore.getState().setChatPaneWidth(EDITOR_CHAT_PANE_WIDTH)
    }
    setEditorImageUrl(imageUrl)
    setIsEditorOpen(true)
  }, [isEditorOpen])

  const handleEditorBack = useCallback(() => {
    useDevelopPageStore.getState().setChatPaneWidth(priorPaneWidthRef.current)
    setIsEditorOpen(false)
    setEditorImageUrl(null)
  }, [])

  // Grid-view back handler — used when the grid was entered externally
  // (e.g. the chat "See all" carrot). Restores the captured tab + mode.
  const handleBackFromGrid = useCallback(() => {
    if (mediaReturnTab != null) {
      setActiveChatTab(mediaReturnTab)
      if (mediaReturnMobileMode != null) {
        useDevelopPageStore.getState().handleMobileModeChange(mediaReturnMobileMode)
      }
    }
    clearMediaReturnState()
  }, [mediaReturnTab, mediaReturnMobileMode, setActiveChatTab, clearMediaReturnState])

  const handleEditorDone = useCallback(() => {
    // Bust the thumbnail cache for upload thumbnails that were overwritten in-place.
    setThumbnailBustKey((k) => k + 1)
    handleEditorBack()
  }, [handleEditorBack])

  if (!appId) return null

  if (activeSlotName && isEditorOpen) {
    return (
      <div className="flex flex-col h-full min-h-0 px-2 md:px-0 md:pt-0 pb-2 gap-2">
        <button
          type="button"
          onClick={handleEditorBack}
          className="shrink-0 flex items-center gap-1 text-sm text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor transition-colors hover:cursor-pointer"
        >
          <ChevronLeftIcon className="size-2 rtl:scale-x-[-1]" />
          <span>{t('builder_common_back')}</span>
        </button>
        <div className="flex-1 min-h-0 flex flex-col">
          <ImageEditorPanel
            appId={appId}
            slotName={activeSlotName}
            sourceUrl={editorImageUrl}
            onDone={handleEditorDone}
            onCancel={handleEditorBack}
          />
        </div>
      </div>
    )
  }

  if (activeSlotName) {
    return (
      <div
        data-media-delete-boundary
        className="relative flex flex-col h-full min-h-0 px-2 md:px-0 md:pt-0 pb-2 gap-2"
      >
        <button
          type="button"
          onClick={handleBack}
          className="shrink-0 flex items-center gap-1 text-sm text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor transition-colors hover:cursor-pointer"
          data-testid="media-panel-back-button"
        >
          <ChevronLeftIcon className="size-2 rtl:scale-x-[-1]" />
          <span>{t('builder_common_back')}</span>
        </button>
        <div className="flex-1 min-h-0 flex flex-col">
          <MediaSlotDetail
            appId={appId}
            slotName={activeSlotName}
            forkContext={slotDetailEntry === 'external' ? activeForkContext : null}
            occurrenceIndex={slotDetailEntry === 'external' ? activeOccurrenceIndex : null}
            suppressPreviewScroll={slotDetailEntry === 'external' && suppressPreviewScroll}
            onDone={handleBack}
            onEdit={handleOpenEditor}
          />
        </div>
      </div>
    )
  }

  const showGridBackButton = mediaReturnTab != null

  return (
    <div className="flex flex-col h-full min-h-0 px-2 md:px-0 md:pt-0 pb-2 gap-2">
      {showGridBackButton && (
        <button
          type="button"
          onClick={handleBackFromGrid}
          className="shrink-0 flex items-center gap-1 text-sm text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor transition-colors hover:cursor-pointer"
        >
          <ChevronLeftIcon className="size-2 rtl:scale-x-[-1]" />
          <span>{t('builder_common_back')}</span>
        </button>
      )}
      <div className="flex-1 overflow-y-auto pr-1">
        <SourceImagesLibrary
          appId={appId}
          mediaManifest={manifest}
          refreshKey={thumbnailBustKey}
        />
        <MediaSlotsGrid
          manifest={manifest}
          slotNames={slotNames}
          appId={appId}
          isLoading={isLoading}
          error={error}
          onRetry={() => { void refetch() }}
          onSelectSlot={handleSelectSlot}
          thumbnailBustKey={thumbnailBustKey}
        />
      </div>
    </div>
  )
}
