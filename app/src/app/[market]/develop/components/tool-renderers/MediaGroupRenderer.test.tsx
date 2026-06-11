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
})
