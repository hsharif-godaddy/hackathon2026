'use client'

import { Image } from 'lucide-react'
import { useParams } from 'next/navigation'

import ToolHeader from '@/app/develop/components/tool-renderers/ToolHeader'
import { logger } from '@/lib/request-context'
import { useMediaSlotDialogStore } from '@/stores/useMediaSlotDialogStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

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
  const params = useParams()
  const appId = params?.id as string | undefined
  const openDialog = useMediaSlotDialogStore((state) => state.openDialog)

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

  // Format slot name for display
  const formatSlotName = (slot: string): string => {
    return slot
      .split('/')
      .filter(
        (part) =>
          part && part !== 'pages' && part !== 'components' && part !== 'sections'
      )
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
      .join(' ')
  }

  const handleThumbnailClick = (slotName: string) => {
    if (appId && slotName) {
      openDialog(appId, slotName)
    }
  }

  // Show loading state if any tools are still running
  if (runningSlots.length > 0 && completedSlots.length === 0) {
    return (
      <ToolHeader
        icon={<Image className="w-2 h-2" />} /* eslint-disable-line jsx-a11y/alt-text */
        displayName="Selecting media..."
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
        icon={<Image className="w-2 h-2" />} /* eslint-disable-line jsx-a11y/alt-text */
        displayName={`Media selection failed: ${firstError}`}
        toolStatus="completed"
        hasDetails={false}
      />
    )
  }

  // Nothing to show
  if (completedSlots.length === 0) {
    return null
  }

  return (
    <div className="my-2">
      {/* Horizontal scroll container with vertical cards */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mb-2">
        {completedSlots.map((slot) => (
          <button
            type="button"
            key={slot.toolCall.id}
            onClick={() => handleThumbnailClick(slot.result!.slot)}
            className="flex-shrink-0 w-12 cursor-pointer group text-left"
          >
            {/* Square image */}
            <div className="w-12 h-12 rounded-md overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ensureHttps(slot.result!.resolvedUrl!)}
                alt={slot.result!.searchQuery}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            </div>

            {/* Slot info below image */}
            <p className="text-[10px] font-medium mt-1 leading-tight break-words hyphens-auto">
              {formatSlotName(slot.result!.slot)}
            </p>
            {(slot.result!.alternatives?.length ?? 0) > 0 && (
              <p className="text-[10px] text-intents-ux-textSubtle-textColor">
                {slot.result!.alternatives!.length} option
                {slot.result!.alternatives!.length !== 1 ? 's' : ''}
              </p>
            )}
          </button>
        ))}

        {/* Running slots placeholder */}
        {runningSlots.map((slot) => (
          <div
            key={slot.toolCall.id}
            className="flex-shrink-0 w-12"
          >
            <div className="w-12 h-12 rounded-md bg-intents-ux-boxLowContrast-backgroundColor animate-pulse" />
            <p className="text-xs text-intents-ux-textSubtle-textColor mt-1">
              Loading...
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
