import { describe, expect, it, vi } from 'vitest'

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { isVideoGenerateToolName, parseGenerateVideoTool } from './parseGenerateVideoTool'

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: mockLoggerError,
  },
}))

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tool-1',
    name: 'media-video__generate_video',
    status: 'completed',
    input: { prompt: 'Cute cat playing' },
    ...overrides,
  }
}

describe('parseGenerateVideoTool', () => {
  it('extracts video URL from structuredContent', () => {
    const parsed = parseGenerateVideoTool(makeToolCall({
      result: {
        structuredContent: {
          url: '/airo-assets/uploads/cat.mp4',
          slotUrl: '/airo-assets/videos/pages/home/gallery-1',
        },
      },
    }))

    expect(parsed.prompt).toBe('Cute cat playing')
    expect(parsed.videoUrl).toBe('/airo-assets/uploads/cat.mp4')
    expect(parsed.slotPath).toBe('pages/home/gallery-1')
  })

  it('surfaces tool error from result payload', () => {
    const parsed = parseGenerateVideoTool(makeToolCall({
      result: { error: 'Insufficient credits for AI video generation' },
    }))

    expect(parsed.error).toBe('Insufficient credits for AI video generation')
    expect(parsed.videoUrl).toBeUndefined()
  })

  it('surfaces toolCall.error when present', () => {
    const parsed = parseGenerateVideoTool(makeToolCall({
      error: 'Generation timed out',
      result: undefined,
    }))

    expect(parsed.error).toBe('Generation timed out')
  })

  it('logs when a string result fails JSON parsing', () => {
    mockLoggerError.mockClear()

    parseGenerateVideoTool(makeToolCall({
      result: 'not-json',
    }))

    expect(mockLoggerError).toHaveBeenCalledWith(
      'tool.video_generator.parse.failed',
      expect.objectContaining({ resultLength: 8 }),
    )
  })

  it('logs when a completed result has neither url nor error', () => {
    mockLoggerError.mockClear()

    parseGenerateVideoTool(makeToolCall({
      result: { sessionId: 'vid-1' },
    }))

    expect(mockLoggerError).toHaveBeenCalledWith(
      'tool.video_generator.parse.failed',
      expect.objectContaining({
        error: 'Completed generate_video result missing url and error',
      }),
    )
  })
})

describe('isVideoGenerateToolName', () => {
  it('matches generate_video tool names', () => {
    expect(isVideoGenerateToolName('media-video__generate_video')).toBe(true)
    expect(isVideoGenerateToolName('media__generate_video')).toBe(true)
    expect(isVideoGenerateToolName('media')).toBe(false)
  })
})
