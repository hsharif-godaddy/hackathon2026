'use client'

import { useParams } from 'next/navigation'
import ChevronRightIcon from '@ux/icon/chevron-right'
import ImageIcon from '@ux/icon/image'
import PlusIcon from '@ux/icon/plus'

import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { ChatTab } from '@/app/develop/components/types'
import { useChatTabs } from '@/hooks/useChatTabs'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
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

  // Helper to ensure URLs have proper protocol
  // Handles http/https URLs, protocol-relative URLs, and other URI schemes
  const ensureHttps = (url: string): string => {
    if (!url) return url
    // Already has a URI scheme (http:, https:, data:, blob:, etc.)
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(url)) {
      return url
    }
    // Protocol-relative URL (//example.com)
    if (url.startsWith('//')) {
      return `https:${url}`
    }
    // No scheme - add https://
    return `https://${url}`
  }

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
      navigateToSlot('__GRID__')
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
                  src={ensureHttps(previewUrl || '')}
                  alt={slot.result!.searchQuery}
                  className="w-full h-full object-cover rounded-md transition-transform"
                />
                {/* Overlay that expands on hover */}
                <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-md bg-intents-ux-box-backgroundColor shadow-md transition-all duration-300 ease-in-out origin-bottom-right group-hover:w-full group-hover:h-full group-hover:bottom-0 group-hover:right-0 group-hover:rounded-md group-hover:backdrop-blur-sm flex flex-col items-center justify-center">
                  <PlusIcon className="size-2 transition-all duration-300 ease-in-out group-hover:-mt-1" />
                  {/* Show alternatives count on hover */}
                  {(slot.result!.alternativeCount || slot.result!.alternatives?.length) && (
                    <span className="absolute top-1/2 scale-0 text-xs text-intents-ux-text-textColor font-medium transition-all duration-300 ease-in-out group-hover:scale-100 group-hover:mt-1">
                      {t('builder_common_options_count', {
                        count: slot.result!.alternativeCount || slot.result!.alternatives!.length
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
            className="flex-shrink-0 w-8 cursor-pointer group justify-center items-center text-center"
            data-eid={generateClickEID("develop.media_group.all")}
          >
            <div className="w-8 h-12 flex items-center justify-center">
              <ChevronRightIcon className="w-4 h-4 mx-auto" />
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
