/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { renderWithProviders } from '@/tests/test-utils'
import MediaGroupRenderer from './MediaGroupRenderer'

const mockNavigateToSlot = vi.fn()
const mockSetActiveChatTab = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/test-app-id/develop',
  useParams: () => ({ id: 'test-app-id' }),
}))

vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: (selector: unknown) => (selector as (state: unknown) => unknown)({
    navigateToSlot: mockNavigateToSlot,
  }),
}))

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveChatTab: mockSetActiveChatTab,
  }),
}))

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: unknown) => (selector as (state: unknown) => unknown)({
    getServerState: () => ({ url: 'https://preview.example/app?airoShareToken=abc' }),
  }),
}))

function makeToolCall(overrides: Partial<ToolCall> & { result?: unknown }): ToolCall {
  return {
    id: 'tc-1',
    name: 'media',
    status: 'completed',
    input: JSON.stringify({ slot: 'pages/home/hero', query: 'dog grooming' }),
    result: JSON.stringify({
      success: true,
      slot: 'pages/home/hero',
      slotUrl: '/airo-assets/images/pages/home/hero',
      mediaType: 'image',
      searchQuery: 'dog grooming',
      resolvedUrl: 'https://media.gettyimages.com/test.jpg',
      alternativeCount: 3,
      alternatives: ['https://a.jpg', 'https://b.jpg', 'https://c.jpg'],
    }),
    ...overrides,
  } as ToolCall
}

describe('MediaGroupRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders alternative count badge when alternativeCount > 0', () => {
    const toolCalls = [makeToolCall({ id: 'tc-1' })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.getByText('builder_common_options_count')).toBeInTheDocument()
  })

  it('does not render "0" when alternativeCount is 0 and alternatives is empty', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: 'https://media.gettyimages.com/test.jpg',
        alternativeCount: 0,
        alternatives: [],
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('builder_common_options_count')).not.toBeInTheDocument()
  })

  it('does not render badge when alternativeCount is 0 and alternatives is undefined', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: 'https://media.gettyimages.com/test.jpg',
        alternativeCount: 0,
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('builder_common_options_count')).not.toBeInTheDocument()
  })

  it('does not render badge when both alternativeCount and alternatives are absent', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: 'https://media.gettyimages.com/test.jpg',
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('builder_common_options_count')).not.toBeInTheDocument()
  })

  it('proxies a relative /airo-assets/* resolvedUrl through the preview origin', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: '/airo-assets/uploads/b50498b248e9f8e51a2120b37122cea9.jpg',
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.getByAltText('dog grooming')).toHaveAttribute(
      'src',
      'https://preview.example/airo-assets/uploads/b50498b248e9f8e51a2120b37122cea9.jpg'
    )
  })

  it('renders an absolute resolvedUrl unchanged', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: 'https://media.gettyimages.com/test.jpg',
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.getByAltText('dog grooming')).toHaveAttribute(
      'src',
      'https://media.gettyimages.com/test.jpg'
    )
  })

  it('uses alternatives.length as count when alternativeCount is absent', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: 'https://media.gettyimages.com/test.jpg',
        alternatives: ['https://a.jpg', 'https://b.jpg'],
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.getByText('builder_common_options_count')).toBeInTheDocument()
  })

  it('does not show NaN when alternativeCount is undefined and alternatives is undefined', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: 'https://media.gettyimages.com/test.jpg',
        // alternativeCount and alternatives both undefined
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument()
    expect(screen.queryByText('builder_common_options_count')).not.toBeInTheDocument()
  })

  it('does not show NaN when alternativeCount is null and alternatives is undefined', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-1',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/hero',
        slotUrl: '/airo-assets/images/pages/home/hero',
        mediaType: 'image',
        searchQuery: 'dog grooming',
        resolvedUrl: 'https://media.gettyimages.com/test.jpg',
        alternativeCount: null,
        // alternatives undefined
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument()
    expect(screen.queryByText('builder_common_options_count')).not.toBeInTheDocument()
  })

  it('renders stock video chat thumbnails as still images when a jpeg thumb exists', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-video',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/gallery-1',
        slotUrl: '/airo-assets/videos/pages/home/gallery-1',
        mediaType: 'video',
        searchQuery: 'cute cat playing',
        resolvedUrl: 'https://blobby.dev-wsimg.com/getty/videos/2155415555',
        thumbnailUrl: 'https://media.gettyimages.com/cat-thumb.jpg',
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    const video = document.querySelector('video')
    expect(video).not.toBeInTheDocument()
    expect(screen.getByAltText('cute cat playing')).toHaveAttribute(
      'src',
      'https://media.gettyimages.com/cat-thumb.jpg',
    )
  })

  it('renders a play placeholder when the video thumb is an mp4 preview URL', () => {
    const toolCalls = [makeToolCall({
      id: 'tc-video-mp4-thumb',
      result: JSON.stringify({
        success: true,
        slot: 'pages/home/gallery-1',
        slotUrl: '/airo-assets/videos/pages/home/gallery-1',
        mediaType: 'video',
        searchQuery: 'cute cat playing',
        resolvedUrl: 'https://blobby.dev-wsimg.com/getty/videos/2155415555',
        thumbnailUrl: 'https://media.gettyimages.com/id/1/video/clip.mp4?sig=abc',
      }),
    })]

    renderWithProviders(
      <MediaGroupRenderer toolCalls={toolCalls} />
    )

    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(screen.queryByAltText('cute cat playing')).not.toBeInTheDocument()
    expect(screen.getByLabelText('cute cat playing')).toBeInTheDocument()
  })
})
