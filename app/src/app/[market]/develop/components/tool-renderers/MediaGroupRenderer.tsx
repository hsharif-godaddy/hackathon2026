'use client'

import { useParams } from 'next/navigation'
import ChevronRightIcon from '@ux/icon/chevron-right'
import ImageIcon from '@ux/icon/image'
import PlusIcon from '@ux/icon/plus'

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/slotImageUrl'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { ChatTab } from '@/app/[market]/develop/components/types'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { MEDIA_GRID_VIEW, useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { generateClickEID } from '@/utils/instrumentation'

interface MediaSlotInput {
  slot: string
  query: string
  mediaType?: 'image' | 'video'
  size?: {
    width: number
    height: number
    fit?: 'cover' | 'contain' | 'crop'
  }
  orientations?: string
  compositions?: string
  count?: number
}

interface MediaSlotResultData {
  success: boolean
  slot: string
  slotUrl: string
  mediaType: 'image' | 'video'
  searchQuery: string
  resolvedUrl?: string
  /** For videos: thumbnail image URL for preview display */
  thumbnailUrl?: string
  alternatives?: string[]
  alternativeCount?: number
  error?: string
}

interface ParsedMediaSlot {
  toolCall: ToolCall
  input: MediaSlotInput | null
  result: MediaSlotResultData | null
}

interface MediaGroupRendererProps {
  toolCalls: ToolCall[]
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
}

/**
 * Groups multiple consecutive media slot tool calls into a compact view
 *
 * Shows thumbnails of completed media slots. Clicking any thumbnail
 * opens the MediaSlotDialog with fresh data from the API.
 */
export default function MediaGroupRenderer({
  toolCalls,
  isActiveStream: _isActiveStream = false,
}: MediaGroupRendererProps) {
  const t = useTranslations()
  const params = useParams()
  const appId = params?.id as string | undefined
  const navigateToSlot = useMediaSlotDialogStore((state) => state.navigateToSlot)
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId ?? '')?.url ?? null)
  const { setActiveChatTab } = useChatTabs()

  // Parse all tool calls
  const parsedSlots: ParsedMediaSlot[] = toolCalls.map((toolCall) => {
    let input: MediaSlotInput | null = null
    let result: MediaSlotResultData | null = null

    if (toolCall.input) {
      input = toolCall.input as unknown as MediaSlotInput
    }

    if (toolCall.result) {
      try {
        if (typeof toolCall.result === 'string') {
          result = JSON.parse(toolCall.result) as MediaSlotResultData
        } else {
          result = toolCall.result as unknown as MediaSlotResultData
        }
      } catch (e) {
        logger.error('tool.media_group.parse.failed', {
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    return { toolCall, input, result }
  })

  // Filter to only completed, successful slots
  const completedSlots = parsedSlots.filter(
    (slot) => slot.toolCall.status === 'completed' && slot.result?.success && slot.result?.resolvedUrl
  )

  const runningSlots = parsedSlots.filter((slot) => slot.toolCall.status === 'running')

  // Slots that completed but failed (no success or error)
  const failedSlots = parsedSlots.filter(
    (slot) => slot.toolCall.status === 'completed' && (!slot.result?.success || slot.result?.error)
  )

  const handleThumbnailClick = (slotName: string) => {
    if (appId && slotName) {
      navigateToSlot(slotName)
      setActiveChatTab(ChatTab.MEDIAS)
    }
  }

  // Show loading state if any tools are still running
  if (runningSlots.length > 0 && completedSlots.length === 0) {
    return (
      <ToolHeader
        icon={<ImageIcon className="w-2 h-2" />}
        displayName={t('builder_medias_selecting')}
        toolStatus="running"
        hasDetails={false}
      />
    )
  }

  // Show error state if all slots failed
  if (completedSlots.length === 0 && failedSlots.length > 0) {
    const firstError = failedSlots[0]?.result?.error || 'Failed to load media'
    return (
      <ToolHeader
        icon={<ImageIcon className="w-2 h-2" />}
        displayName={t('builder_medias_selection_failed', { error: firstError })}
        toolStatus="completed"
        hasDetails={false}
      />
    )
  }

  // Nothing to show
  if (completedSlots.length === 0) {
    return null
  }

  const handleSeeAllClick = () => {
    if (appId) {
      navigateToSlot(MEDIA_GRID_VIEW)
      setActiveChatTab(ChatTab.MEDIAS)
    }
  }

  // Show only first 2 thumbnails when there are more than 2 completed slots
  const visibleSlots = completedSlots.length > 3 ? completedSlots.slice(0, 3) : completedSlots
  const showSeeAllButton = completedSlots.length > 3

  return (
    <div className="my-2">
      {/* 2 images + See all button */}
      <div className="flex gap-1 overflow-x-scroll">
        {visibleSlots.map((slot) => {
          // For videos, use thumbnailUrl for preview; for images, use resolvedUrl
          const isVideo = slot.result!.mediaType === 'video'
          const previewUrl = isVideo
            ? slot.result!.thumbnailUrl || slot.result!.resolvedUrl
            : slot.result!.resolvedUrl

          return (
            <button
              type="button"
              key={slot.toolCall.id}
              onClick={() => handleThumbnailClick(slot.result!.slot)}
              className="flex-shrink-0 w-12 cursor-pointer group text-left"
              data-eid={generateClickEID("develop.media_group.image")}
            >
              {/* Square thumbnail (uses thumbnailUrl for videos, resolvedUrl for images) */}
              <div className="w-12 h-12 rounded-md overflow-hidden relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getSlotImageUrl(slot.result!.slot, previewUrl || '', previewBaseUrl, slot.result!.mediaType)}
                  alt={slot.result!.searchQuery}
                  className="w-full h-full object-cover rounded-md transition-all duration-300 group-hover:opacity-20"
                />
                {/* Centered text on hover */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none">
                  <PlusIcon className="size-3 opacity-0 transition-all duration-300 ease-in-out group-hover:opacity-100" />
                  {(slot.result!.alternativeCount || slot.result!.alternatives?.length || 0) > 0 && (
                    <span className="text-sm text-black font-medium opacity-0 transition-all duration-300 ease-in-out group-hover:opacity-100">
                      {t('builder_common_options_count', {
                        count: slot.result!.alternativeCount || slot.result!.alternatives?.length || 0
                      })}
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}

        {/* See all button when more than 2 slots */}
        {showSeeAllButton && (
          <button
            type="button"
            onClick={handleSeeAllClick}
            className="flex-shrink-0 cursor-pointer"
            data-eid={generateClickEID("develop.media_group.all")}
          >
            <div
              className="w-8 h-12 flex justify-center items-center rounded-md transition-colors duration-200"
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <ChevronRightIcon className="w-4 h-4" />
            </div>
          </button>
        )}

        {/* Running slots placeholder */}
        {runningSlots.map((slot) => (
          <div
            key={slot.toolCall.id}
            className="flex-shrink-0 w-12"
          >
            <div className="w-12 h-12 rounded-md bg-intents-ux-boxLowContrast-backgroundColor animate-pulse" />
            <p className="text-xs text-intents-ux-textSubtle-textColor mt-1">
              {t('builder_common_loading')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
