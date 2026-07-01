'use client'

import { Video } from 'lucide-react'
import { useParams } from 'next/navigation'

import { resolveGeneratedVideoPlaybackUrl } from '@/app/[market]/develop/components/media/slotImageUrl'
import MessageToolCallsRenderer from '@/app/[market]/develop/components/MessageToolCallsRenderer'
import {
  isVideoGenerateToolName,
  type ParsedGenerateVideoTool,
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

function isFailedVideoTool(item: ParsedGenerateVideoTool): boolean {
  if (item.toolCall.status === 'running') {
    return false
  }
  return Boolean(item.error)
    || item.toolCall.status === 'incomplete'
    || (item.toolCall.status === 'completed' && !item.videoUrl)
}

function getVideoToolFailureMessage(
  item: ParsedGenerateVideoTool,
  translate: (key: string, values?: Record<string, unknown>, defaultMessage?: string) => string,
): string | undefined {
  if (item.error) {
    return item.error
  }
  if (item.toolCall.status === 'incomplete') {
    return translate(
      'builder_tools_video_generation_interrupted',
      undefined,
      defaultMessageForVideoToolKey('builder_tools_video_generation_interrupted'),
    )
  }
  if (item.toolCall.status === 'completed' && !item.videoUrl) {
    return translate(
      'builder_tools_video_generate_failed_count',
      { count: 1 },
      defaultMessageForVideoToolKey('builder_tools_video_generate_failed_count'),
    )
  }
  return undefined
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
  const failed = parsed.filter(isFailedVideoTool)

  const uniqueErrors = [...new Set(
    failed
      .map((item) => getVideoToolFailureMessage(item, t))
      .filter((error): error is string => Boolean(error)),
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
    const summary: string = uniqueErrors.length === 1
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
                src={resolveGeneratedVideoPlaybackUrl(item.videoUrl!, previewBaseUrl, {
                  slotUrl: item.slotUrl,
                  slotPath: item.slotPath,
                })}
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
