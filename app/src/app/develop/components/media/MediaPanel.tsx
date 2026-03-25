'use client'

import { useCallback, useEffect, useState } from 'react'
import ChevronLeftIcon from '@ux/icon/chevron-left'

import { formatSlotName } from '@/app/develop/components/media/MediaSlotDetail'
import { MediaSlotDetail } from '@/app/develop/components/media/MediaSlotDetail'
import { MediaSlotsGrid } from '@/app/develop/components/media/MediaSlotsGrid'
import { useAppIdFromParams } from '@/app/develop/components/utils'
import { useMediaManifest } from '@/hooks/useMediaManifest'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'

export default function MediaPanel() {
  const appId = useAppIdFromParams()
  const [activeSlotName, setActiveSlotName] = useState<string | null>(null)

  const panelSlotName = useMediaSlotDialogStore((state) => state.panelSlotName)
  const clearPanelSlot = useMediaSlotDialogStore((state) => state.clearPanelSlot)

  const { manifest, slotNames, isLoading, error, refetch } = useMediaManifest({
    appId: appId || null
  })

  // Respond to external navigation requests (e.g., from preview "Swap Image")
  useEffect(function handleExternalNavigation() {
    if (panelSlotName) {
      if (panelSlotName === '__GRID__') {
        setActiveSlotName(null)
      } else {
        setActiveSlotName(panelSlotName)
      }
      clearPanelSlot()
    }
  }, [panelSlotName, clearPanelSlot])

  const handleSelectSlot = useCallback((slotName: string) => {
    setActiveSlotName(slotName)
  }, [])

  const handleBack = useCallback(() => {
    setActiveSlotName(null)
    refetch()
  }, [refetch])

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
          <span>{formatSlotName(activeSlotName)}</span>
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
