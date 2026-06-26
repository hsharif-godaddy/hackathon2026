/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { usePublishFlow } from '@/hooks/social/usePublishFlow'
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
  generateClickEID: vi.fn(function () { return 'test-eid'; })
}))

vi.mock('@/hooks/useUserLocale', () => ({
  useUserLocale: vi.fn(() => 'en-US')
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

    it('shows "View on" buttons for all successful platforms with URLs', () => {
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

      const viewButtons = screen.getAllByRole('link', { name: /builder_widgets_socialpublish_view/ })
      expect(viewButtons).toHaveLength(2)
      expect(viewButtons[0]).toHaveAttribute('href', 'https://facebook.com/post/123')
      expect(viewButtons[1]).toHaveAttribute('href', 'https://instagram.com/p/123')
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
      const viewButtons = screen.getAllByRole('link', { name: /builder_widgets_socialpublish_view/ })
      expect(viewButtons).toHaveLength(1)
      expect(viewButtons[0]).toHaveAttribute('href', 'https://facebook.com/post/123')
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

  describe('Scheduled publish success copy', () => {
    it('shows scheduled success copy when scheduledAt is set', () => {
      const scheduledAt = new Date('2026-07-01T15:30:00.000Z')
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook'],
          message: 'Test post',
          imageUrls: [],
          scheduledAt: scheduledAt.toISOString()
        },
        platformStatuses: {
          facebook: { status: PublishFlowState.Success, result: { id: 'fb-123' } }
        },
        overallStatus: PublishFlowState.Success
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} />)

      expect(screen.getByText('builder_widgets_socialschedule_success')).toBeInTheDocument()
      expect(screen.queryByText('builder_widgets_socialpublish_success')).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /builder_widgets_socialpublish_view/ })).not.toBeInTheDocument()
    })

    it('shows immediate success copy when scheduledAt is not set', () => {
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
      expect(screen.queryByText('builder_widgets_socialschedule_success')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_post' })).toBeInTheDocument()
    })
  })

  describe('Scheduled publish deserialization', () => {
    // Regression: scheduledAt arrives as an ISO string after JSON serialization over
    // the WebSocket. If platformData[].scheduledAt is not rehydrated to a Date, the
    // publish flow passes a string to publishToFacebook and crashes with
    // "params.scheduledAt.getTime is not a function".
    it('rehydrates platformData[].scheduledAt from ISO string to a Date for a fresh publish', () => {
      const scheduledIso = '2026-07-01T15:30:00.000Z'
      const initialResult = {
        pendingPublish: {
          platforms: ['facebook'],
          message: 'Test post',
          imageUrls: [],
          scheduledAt: scheduledIso,
          platformData: [
            { platform: 'facebook', message: 'Test post', imageUrls: [], scheduledAt: scheduledIso }
          ]
        }
      }

      renderWithProviders(<PublishWidget {...defaultProps} initialResult={initialResult} isLastAssistantMessage={true} />)

      expect(usePublishFlow).toHaveBeenCalled()
      const pendingPublish = vi.mocked(usePublishFlow).mock.calls[0][2] as any
      expect(pendingPublish.platformData[0].scheduledAt).toBeInstanceOf(Date)
      expect(pendingPublish.platformData[0].scheduledAt.toISOString()).toBe(scheduledIso)
      expect(pendingPublish.scheduledAt).toBeInstanceOf(Date)
      expect(pendingPublish.scheduledAt.toISOString()).toBe(scheduledIso)
    })
  })
})
