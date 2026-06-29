'use client'

import { Video } from 'lucide-react'
import { useParams } from 'next/navigation'

import { getPreviewOrigin, getSlotImageUrl } from '@/app/[market]/develop/components/media/slotImageUrl'
import MessageToolCallsRenderer from '@/app/[market]/develop/components/MessageToolCallsRenderer'
import {
  isVideoGenerateToolName,
  parseGenerateVideoTool,
} from '@/app/[market]/develop/components/tool-renderers/parseGenerateVideoTool'
import ToolHeader from '@/app/[market]/develop/components/tool-renderers/ToolHeader'
import { useTranslations } from '@/hooks/useTranslations'
import { defaultMessageForVideoToolKey } from '@/lib/translations/video-tool-defaults'
import { useServerPollingStore } from '@/stores/useServerPollingStore'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

interface VideoGroupRendererProps {
  toolCalls: ToolCall[]
  isActiveStream?: boolean
  isLastAssistantMessage?: boolean
}

function resolvePlaybackUrl(
  videoUrl: string,
  slotUrl: string | undefined,
  slotPath: string | undefined,
  previewBaseUrl: string | null,
): string {
  if (!previewBaseUrl) {
    return videoUrl
  }
  if (slotUrl?.startsWith('/airo-assets/videos/')) {
    return `${getPreviewOrigin(previewBaseUrl)}${slotUrl}`
  }
  if (videoUrl.startsWith('/airo-assets/uploads/')) {
    return `${getPreviewOrigin(previewBaseUrl)}${videoUrl}`
  }
  return getSlotImageUrl(slotPath ?? null, videoUrl, previewBaseUrl, 'video')
}

export default function VideoGroupRenderer({
  toolCalls,
  isActiveStream: _isActiveStream = false,
  isLastAssistantMessage,
}: VideoGroupRendererProps) {
  const t = useTranslations()
  const params = useParams()
  const appId = params?.id as string | undefined
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId ?? '')?.url ?? null)

  const videoTools = toolCalls.filter((toolCall) => isVideoGenerateToolName(toolCall.name))
  if (videoTools.length === 0) {
    return null
  }

  if (videoTools.length === 1) {
    return (
      <MessageToolCallsRenderer
        toolCalls={videoTools}
        isLastAssistantMessage={isLastAssistantMessage}
      />
    )
  }

  const parsed = videoTools.map(parseGenerateVideoTool)
  const runningCount = parsed.filter((item) => item.toolCall.status === 'running').length
  const succeeded = parsed.filter((item) => item.toolCall.status === 'completed' && item.videoUrl && !item.error)
  const failed = parsed.filter((item) => {
    if (item.toolCall.status === 'running') {
      return false
    }
    return Boolean(item.error) || (item.toolCall.status === 'completed' && !item.videoUrl)
  })

  const uniqueErrors = [...new Set(
    failed.map((item) => item.error).filter((error): error is string => Boolean(error)),
  )]

  const generatingLabel = (count: number): string =>
    t(
      'builder_tools_active_video_generate_count',
      { count },
      defaultMessageForVideoToolKey('builder_tools_active_video_generate_count'),
    )

  const failedCountLabel = (count: number): string =>
    t(
      'builder_tools_video_generate_failed_count',
      { count },
      defaultMessageForVideoToolKey('builder_tools_video_generate_failed_count'),
    )

  if (runningCount > 0 && succeeded.length === 0 && failed.length === 0) {
    return (
      <ToolHeader
        icon={<Video className="w-2 h-2" />}
        displayName={generatingLabel(runningCount)}
        toolStatus="running"
        hasDetails={false}
      />
    )
  }

  if (failed.length > 0 && succeeded.length === 0 && runningCount === 0) {
    const summary = uniqueErrors.length === 1
      ? uniqueErrors[0]
      : failedCountLabel(failed.length)
    return (
      <ToolHeader
        icon={<Video className="w-2 h-2" />}
        displayName={summary}
        toolStatus="error"
        hasDetails={false}
      />
    )
  }

  return (
    <div className="my-2 space-y-2">
      {(runningCount > 0 || failed.length > 0) && (
        <ToolHeader
          icon={<Video className="w-2 h-2" />}
          displayName={
            runningCount > 0
              ? generatingLabel(runningCount)
              : failedCountLabel(failed.length)
          }
          toolStatus={runningCount > 0 ? 'running' : 'error'}
          hasDetails={false}
        />
      )}

      {uniqueErrors.length === 1 && failed.length > 1 && (
        <p className="text-xs text-foreground/60">{uniqueErrors[0]}</p>
      )}

      {succeeded.length > 0 && (
        <div className="flex gap-1 overflow-x-auto">
          {succeeded.map((item) => (
            <div key={item.toolCall.id} className="flex-shrink-0 w-24">
              <video
                src={resolvePlaybackUrl(item.videoUrl!, item.slotUrl, item.slotPath, previewBaseUrl)}
                className="w-full aspect-video object-cover rounded-md bg-intents-ux-boxLowContrast-backgroundColor"
                muted
                playsInline
                preload="metadata"
                aria-label={item.prompt}
              />
              <p className="text-xs text-foreground/60 mt-1 line-clamp-2">{item.prompt}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
