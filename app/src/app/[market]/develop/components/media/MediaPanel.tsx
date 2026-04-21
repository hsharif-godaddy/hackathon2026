'use client'

import { useCallback, useEffect, useState } from 'react'
import ChevronLeftIcon from '@ux/icon/chevron-left'

import { MediaSlotDetail } from '@/app/[market]/develop/components/media/MediaSlotDetail'
import { MediaSlotsGrid } from '@/app/[market]/develop/components/media/MediaSlotsGrid'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useTranslations } from '@/hooks/useTranslations'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'

type SlotDetailEntry = 'grid' | 'external' | null

export default function MediaPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const [activeSlotName, setActiveSlotName] = useState<string | null>(null)
  const [slotDetailEntry, setSlotDetailEntry] = useState<SlotDetailEntry>(null)

  const panelSlotName = useMediaSlotDialogStore((state) => state.panelSlotName)
  const clearPanelSlot = useMediaSlotDialogStore((state) => state.clearPanelSlot)
  const mediaReturnTab = useMediaSlotDialogStore((state) => state.mediaReturnTab)
  const mediaReturnMobileMode = useMediaSlotDialogStore((state) => state.mediaReturnMobileMode)
  const clearMediaReturnState = useMediaSlotDialogStore((state) => state.clearMediaReturnState)

  const { setActiveChatTab } = useChatTabs()

  const { manifest, slotNames, isLoading, error, refetch } = useMediaManifest({
    appId: appId || null
  })

  // Respond to external navigation requests (e.g., from preview "Swap Image")
  useEffect(function handleExternalNavigation() {
    if (panelSlotName) {
      if (panelSlotName === '__GRID__') {
        setActiveSlotName(null)
        setSlotDetailEntry(null)
      } else {
        setActiveSlotName(panelSlotName)
        setSlotDetailEntry('external')
      }
      clearPanelSlot()
    }
  }, [panelSlotName, clearPanelSlot])

  const handleSelectSlot = useCallback((slotName: string) => {
    clearMediaReturnState()
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
    }
    setActiveSlotName(null)
    setSlotDetailEntry(null)
    void refetch()
  }, [
    slotDetailEntry,
    mediaReturnTab,
    mediaReturnMobileMode,
    setActiveChatTab,
    clearMediaReturnState,
    refetch,
  ])

  if (!appId) return null

  if (activeSlotName) {
    return (
      <div className="flex flex-col h-full min-h-0 px-3 md:px-0 pt-3 md:pt-0 pb-2 gap-2">
        <button
          type="button"
          onClick={handleBack}
          className="shrink-0 flex items-center gap-1 text-sm text-intents-ux-textSubtle-textColor hover:text-intents-ux-text-textColor transition-colors hover:cursor-pointer"
        >
          <ChevronLeftIcon className="size-2" />
          <span>{t('builder_common_back')}</span>
        </button>
        <div className="flex-1 min-h-0 flex flex-col">
          <MediaSlotDetail
            appId={appId}
            slotName={activeSlotName}
            onDone={handleBack}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <MediaSlotsGrid
          manifest={manifest}
          slotNames={slotNames}
          appId={appId}
          isLoading={isLoading}
          error={error}
          onSelectSlot={handleSelectSlot}
        />
      </div>
    </div>
  )
}
