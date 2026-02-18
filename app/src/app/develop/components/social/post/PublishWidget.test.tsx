import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { PublishFlowState } from '@/types/social-posts'
import { PublishWidget } from './PublishWidget'

vi.mock('@/hooks/social/usePublishFlow', () => ({
  usePublishFlow: vi.fn()
}))

vi.mock('@/hooks/useToolResultSync', () => ({
  useToolResultSync: vi.fn()
}))


vi.mock('@/lib/social-platforms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/social-platforms')>()
  return {
    ...actual,
    PLATFORM_CONFIG: {
      facebook: { name: 'Facebook', Icon: () => null },
      instagram: { name: 'Instagram', Icon: () => null }
    }
  }
})

vi.mock('@/utils/social/events', () => ({
  emitPostPublished: vi.fn()
}))

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(() => 'test-eid')
}))


describe('PublishWidget', () => {
  const defaultProps = {
    appId: 'test-app-id',
    publishId: 'test-publish-id',
    toolId: 'test-tool-id',
    conversationId: 'test-conversation-id'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Multi-platform publishing', () => {
    it('shows status for multiple platforms', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook', 'instagram'],
          message: 'Test post',
          imageUrls: []
        },
        platformStatuses: {
          facebook: { status: PublishFlowState.Success, result: { id: 'fb-123' } },
          instagram: { status: PublishFlowState.Success, result: { id: 'ig-123' } }
        },
        overallStatus: PublishFlowState.Success
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
      expect(screen.getByText('builder_widgets_socialpublish_live_on')).toBeInTheDocument()
    })

    it('shows "View on" button for first successful platform', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook', 'instagram'],
          message: 'Test post',
          imageUrls: []
        },
        platformStatuses: {
          facebook: {
            status: PublishFlowState.Success,
            result: { id: 'fb-123', platformUrl: 'https://facebook.com/post/123' }
          },
          instagram: {
            status: PublishFlowState.Success,
            result: { id: 'ig-123', platformUrl: 'https://instagram.com/p/123' }
          }
        },
        overallStatus: PublishFlowState.Success
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_on' })).toBeInTheDocument()
    })

    it('handles partial success (one platform succeeds, one fails)', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook', 'instagram'],
          message: 'Test post',
          imageUrls: []
        },
        platformStatuses: {
          facebook: {
            status: PublishFlowState.Success,
            result: { id: 'fb-123', platformUrl: 'https://facebook.com/post/123' }
          },
          instagram: {
            status: PublishFlowState.Error,
            error: 'Connection expired'
          }
        },
        overallStatus: PublishFlowState.Success
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_on' })).toBeInTheDocument()
    })
  })

  describe('Single platform publishing', () => {
    it('shows single platform status', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook'],
          message: 'Test post',
          imageUrls: []
        },
        platformStatuses: {
          facebook: { status: PublishFlowState.Success, result: { id: 'fb-123', platformUrl: 'https://facebook.com/post/123' } }
        },
        overallStatus: PublishFlowState.Success
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
      expect(screen.getByText('builder_widgets_socialpublish_live_on')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_post' })).toBeInTheDocument()
    })
  })

  describe('Publishing states', () => {
    it('shows preparing state for new publish', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook', 'instagram'],
          message: 'Test post',
          imageUrls: []
        }
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} isLastAssistantMessage={true} />)

      expect(screen.getByText('builder_widgets_socialpublish_preparing')).toBeInTheDocument()
    })

    it('shows publishing state for in-progress publish', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook', 'instagram'],
          message: 'Test post',
          imageUrls: []
        },
        platformStatuses: {
          facebook: { status: PublishFlowState.Publishing },
          instagram: { status: PublishFlowState.Publishing }
        },
        overallStatus: PublishFlowState.Publishing
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(screen.getByText('builder_widgets_socialpublish_publishing_to')).toBeInTheDocument()
    })
  })

  describe('History reload (isFromHistory)', () => {
    it('loads persisted state from history', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook'],
          message: 'Test post',
          imageUrls: []
        },
        platformStatuses: {
          facebook: {
            status: PublishFlowState.Success,
            result: { id: 'fb-123', platformUrl: 'https://facebook.com/post/123' }
          }
        },
        overallStatus: PublishFlowState.Success
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_post' })).toBeInTheDocument()
    })
  })

  describe('Edge cases', () => {
    it('renders nothing when pendingPublish is missing', () => {
      const initialResult = {
        overallStatus: PublishFlowState.Success
      }

      const { container } = renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(container.firstChild).toBeNull()
    })

    it('renders nothing when overallStatus is missing', () => {
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook'],
          message: 'Test post',
          imageUrls: []
        }
      }

      const { container } = renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(container.firstChild).toBeNull()
    })

    it('handles empty platforms array gracefully', () => {
      const initialResult = {
        pendingPublish: {
          platforms: [],
          message: 'Test post',
          imageUrls: []
        },
        platformStatuses: {},
        overallStatus: PublishFlowState.ReadyToPublish
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} isLastAssistantMessage={true} />)

      expect(screen.getByText('builder_widgets_socialpublish_preparing')).toBeInTheDocument()
    })
  })
})
