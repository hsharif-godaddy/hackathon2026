/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import VideoGeneratorToolRenderer from './VideoGeneratorToolRenderer'

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/test-app-id/develop',
  useParams: () => ({ id: 'test-app-id' }),
}))

vi.mock('@/stores/useToolDetailsModalStore', () => ({
  useToolDetailsModal: () => [false, vi.fn()],
}))

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: unknown) => (selector as (state: unknown) => unknown)({
    getServerState: () => ({ url: 'https://preview.example/app?airoShareToken=abc' }),
  }),
}))

describe('VideoGeneratorToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('proxies generated upload URLs through the preview origin for chat playback', () => {
    renderWithProviders(
      <VideoGeneratorToolRenderer
        toolName="media-video__generate_video"
        toolStatus="completed"
        toolId="tool-1"
        input={{ prompt: 'Sunset over mountains' }}
        result={{
          structuredContent: {
            url: '/airo-assets/uploads/ai-video-abc123.mp4',
            slotUrl: '/airo-assets/videos/pages/home/hero',
            sessionId: 'vid-123',
          },
        }}
      />
    )

    const video = screen.getByLabelText('AI generated video')
    expect(video).toHaveAttribute(
      'src',
      'https://preview.example/airo-assets/videos/pages/home/hero'
    )
  })

  it('falls back to upload URL via preview origin when slotUrl is missing', () => {
    renderWithProviders(
      <VideoGeneratorToolRenderer
        toolName="media-video__generate_video"
        toolStatus="completed"
        toolId="tool-2"
        input={{ prompt: 'Ocean waves' }}
        result={{
          structuredContent: {
            url: '/airo-assets/uploads/ai-video-def456.mp4',
            sessionId: 'vid-456',
          },
        }}
      />
    )

    const video = screen.getByLabelText('AI generated video')
    expect(video).toHaveAttribute(
      'src',
      'https://preview.example/airo-assets/uploads/ai-video-def456.mp4'
    )
  })

  it('shows credit error instead of generating placeholder when generation fails', () => {
    renderWithProviders(
      <VideoGeneratorToolRenderer
        toolName="media-video__generate_video"
        toolStatus="completed"
        toolId="tool-3"
        input={{ prompt: 'Cat playing' }}
        result={{ error: 'Insufficient credits for AI video generation' }}
      />
    )

    expect(screen.getByText('Insufficient credits for AI video generation')).toBeInTheDocument()
    expect(screen.queryByText('Generating video…')).not.toBeInTheDocument()
  })

  it('surfaces tool-level error prop when tool status is error', () => {
    renderWithProviders(
      <VideoGeneratorToolRenderer
        toolName="media-video__generate_video"
        toolStatus="error"
        toolId="tool-4"
        input={{ prompt: 'Dog running' }}
        error="Video generation timed out after 300 seconds"
      />
    )

    expect(screen.getByText('Video generation timed out after 300 seconds')).toBeInTheDocument()
    expect(screen.queryByText('Generating video…')).not.toBeInTheDocument()
  })

  it('shows failure header when completed without video url or error', () => {
    renderWithProviders(
      <VideoGeneratorToolRenderer
        toolName="media-video__generate_video"
        toolStatus="completed"
        toolId="tool-5"
        input={{ prompt: 'Empty result' }}
        result={{ sessionId: 'vid-empty' }}
      />
    )

    expect(screen.getByText('1 video generation failed')).toBeInTheDocument()
    expect(screen.queryByText('Generating video…')).not.toBeInTheDocument()
  })
})
