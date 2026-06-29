import { logger } from '@/lib/request-context'
import type { ToolCall } from '@/stores/useStreamingConversationStore'

export interface ParsedGenerateVideoTool {
  toolCall: ToolCall
  prompt: string
  videoUrl?: string
  slotUrl?: string
  slotPath?: string
  error?: string
}

function parseResultObject(result: unknown): Record<string, unknown> | null {
  if (!result) {
    return null
  }
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as Record<string, unknown>
    } catch (error) {
      logger.error('tool.video_generator.parse.failed', {
        error: error instanceof Error ? error.message : String(error),
        resultLength: result.length,
      })
      return null
    }
  }
  if (typeof result === 'object') {
    return result as Record<string, unknown>
  }
  return null
}

export function parseGenerateVideoTool(toolCall: ToolCall): ParsedGenerateVideoTool {
  let prompt = 'Video'
  if (toolCall.input) {
    try {
      const inputObj = typeof toolCall.input === 'string' ? JSON.parse(toolCall.input) : toolCall.input
      if (inputObj && typeof inputObj === 'object' && typeof (inputObj as { prompt?: unknown }).prompt === 'string') {
        prompt = (inputObj as { prompt: string }).prompt
      }
    } catch {
      // Keep default prompt
    }
  }

  const parsed: ParsedGenerateVideoTool = { toolCall, prompt }

  if (toolCall.error) {
    parsed.error = toolCall.error
    return parsed
  }

  const resultObj = parseResultObject(toolCall.result)
  if (!resultObj) {
    return parsed
  }

  if (typeof resultObj.error === 'string') {
    parsed.error = resultObj.error
    return parsed
  }

  const structuredContent = resultObj.structuredContent as Record<string, unknown> | undefined
  if (structuredContent?.url && typeof structuredContent.url === 'string') {
    parsed.videoUrl = structuredContent.url
    if (typeof structuredContent.slotUrl === 'string') {
      parsed.slotUrl = structuredContent.slotUrl
      parsed.slotPath = structuredContent.slotUrl.replace(/^\/airo-assets\/videos\//, '')
    }
    return parsed
  }

  if (typeof resultObj.url === 'string') {
    parsed.videoUrl = resultObj.url
    return parsed
  }

  if (toolCall.status === 'completed' && toolCall.result) {
    logger.error('tool.video_generator.parse.failed', {
      error: 'Completed generate_video result missing url and error',
      resultLength: typeof toolCall.result === 'string' ? toolCall.result.length : undefined,
    })
  }

  return parsed
}

export function isVideoGenerateToolName(name?: string): boolean {
  return name === 'media-video__generate_video' || name === 'media__generate_video'
}
