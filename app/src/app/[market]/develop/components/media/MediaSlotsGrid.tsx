'use client'

import { formatSlotName } from '@/app/[market]/develop/components/media/MediaSlotDetail'
import type { MediaSlot } from '@/app/[market]/develop/components/media/types'
import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useTranslations } from '@/hooks/useTranslations'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import { generateClickEID } from '@/utils/instrumentation'

interface MediaSlotsGridProps {
  manifest: Record<string, MediaSlot> | null
  slotNames: string[]
  appId: string
  isLoading: boolean
  error: string | null
  onSelectSlot: (slotName: string) => void
  /** Increment to bust browser cache for upload thumbnails (e.g. after an overwrite edit) */
  thumbnailBustKey?: number
}

export function MediaSlotsGrid({
  manifest,
  slotNames,
  appId,
  isLoading,
  error,
  onSelectSlot,
  thumbnailBustKey,
}: MediaSlotsGridProps) {
  const t = useTranslations()
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url || null

  if (isLoading) {
    return (
      <PanelSkeleton panelType={ChatTab.MEDIAS} />
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center px-4">
        <p className="text-intents-ux-textSubtle-textColor">
          {t('builder_mediaslot_error_fail_load')}
        </p>
        <p className="text-sm text-intents-ux-textSubtle-textColor mt-1">{error}</p>
      </div>
    )
  }

  if (!manifest || slotNames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center px-4">
        <p className="text-intents-ux-textSubtle-textColor">
          {t('builder_mediaslot_no_images')}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 px-2 md:px-0 md:pt-0 pb-2">
      {slotNames.map(function renderSlot(name) {
        const slot = manifest[name]
        if (!slot) return null

        const thumbnailUrl = slot.thumbnailUrl || slot.currentUrl
        const proxiedUrl = previewBaseUrl && thumbnailUrl
          ? thumbnailUrl.startsWith('/airo-assets/uploads/')
            ? `${previewBaseUrl}${thumbnailUrl}${thumbnailBustKey ? `?_t=${thumbnailBustKey}` : ''}`
            : `${previewBaseUrl}/airo-assets/images/${name}?src=${encodeURIComponent(thumbnailUrl)}`
          : thumbnailUrl

        return (
          <button
            type="button"
            key={name}
            onClick={() => onSelectSlot(name)}
            className="flex flex-col gap-0.5 text-start group hover:cursor-pointer"
            data-eid={generateClickEID("develop.media_panel.slot")}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-md bg-intents-ux-box-backgroundColor border border-intents-ux-box-borderColor group-hover:border-intents-ux-ring-borderColor transition-colors">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proxiedUrl}
                alt={formatSlotName(name)}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            </div>
            <span className="text-sm text-intents-ux-textSubtle-textColor truncate w-full">
              {formatSlotName(name)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
