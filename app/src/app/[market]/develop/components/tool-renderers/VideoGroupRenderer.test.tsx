/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { renderWithProviders } from '@/tests/test-utils'
import VideoGroupRenderer from './VideoGroupRenderer'

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/test-app-id/develop',
  useParams: () => ({ id: 'test-app-id' }),
}))

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: unknown) => (selector as (state: unknown) => unknown)({
    getServerState: () => ({ url: 'https://preview.example/app?token=abc' }),
  }),
}))

function makeVideoToolCall(id: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id,
    name: 'media-video__generate_video',
    status: 'completed',
    input: { prompt: `Prompt ${id}` },
    ...overrides,
  }
}

describe('VideoGroupRenderer', () => {
  it('groups parallel credit failures into one error header', () => {
    const toolCalls = [
      makeVideoToolCall('v1', { result: { error: 'Insufficient credits for AI video generation' } }),
      makeVideoToolCall('v2', { result: { error: 'Insufficient credits for AI video generation' } }),
      makeVideoToolCall('v3', { result: { error: 'Insufficient credits for AI video generation' } }),
      makeVideoToolCall('v4', { result: { error: 'Insufficient credits for AI video generation' } }),
    ]

    renderWithProviders(<VideoGroupRenderer toolCalls={toolCalls} />)

    expect(screen.getByText('Insufficient credits for AI video generation')).toBeInTheDocument()
    expect(screen.queryByText('Generating video…')).not.toBeInTheDocument()
  })

  it('shows a single running header while all generations are in progress', () => {
    const toolCalls = [
      makeVideoToolCall('v1', { status: 'running' }),
      makeVideoToolCall('v2', { status: 'running' }),
    ]

    renderWithProviders(<VideoGroupRenderer toolCalls={toolCalls} />)

    expect(screen.getByText('Generating 2 videos…')).toBeInTheDocument()
  })

  it('delegates to the single-tool renderer when only one generate_video call exists', () => {
    const toolCalls = [
      makeVideoToolCall('v1', {
        result: { error: 'Insufficient credits for AI video generation' },
      }),
    ]

    renderWithProviders(<VideoGroupRenderer toolCalls={toolCalls} />)

    expect(screen.getByText('Insufficient credits for AI video generation')).toBeInTheDocument()
  })

  it('uses singular copy when one of two parallel calls is still running', () => {
    const toolCalls = [
      makeVideoToolCall('v1', { status: 'running' }),
      makeVideoToolCall('v2', { status: 'incomplete' }),
    ]

    renderWithProviders(<VideoGroupRenderer toolCalls={toolCalls} />)

    expect(screen.getByText('Generating 1 video…')).toBeInTheDocument()
  })

  it('proxies grouped video thumbnails through the preview origin', () => {
    const toolCalls = [
      makeVideoToolCall('v1', {
        result: {
          structuredContent: {
            url: '/airo-assets/uploads/ai-video-1.mp4',
            slotUrl: '/airo-assets/videos/pages/home/hero',
          },
        },
      }),
      makeVideoToolCall('v2', {
        result: {
          structuredContent: {
            url: '/airo-assets/uploads/ai-video-2.mp4',
            slotUrl: '/airo-assets/videos/pages/about/hero',
          },
        },
      }),
    ]

    renderWithProviders(<VideoGroupRenderer toolCalls={toolCalls} />)

    const videos = screen.getAllByLabelText(/^Prompt v/)
    expect(videos[0]).toHaveAttribute('src', 'https://preview.example/airo-assets/videos/pages/home/hero')
    expect(videos[1]).toHaveAttribute('src', 'https://preview.example/airo-assets/videos/pages/about/hero')
  })
})
