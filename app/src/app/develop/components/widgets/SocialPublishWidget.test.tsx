import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { PublishFlowState } from '@/types/social-posts'

const mockUsePublishFlow = vi.fn()

vi.mock('@/hooks/social/usePublishFlow', () => ({
  usePublishFlow: (...args: unknown[]) => mockUsePublishFlow(...args)
}))

vi.mock('@/hooks/useToolResultSync', () => ({
  useToolResultSync: vi.fn()
}))

vi.mock('@/utils/social', () => ({
  emitPostPublished: vi.fn(),
  formatPlatformName: (platform: string) => platform.charAt(0).toUpperCase() + platform.slice(1)
}))

vi.mock('@/lib/social-platforms', () => ({
  PLATFORM_CONFIG: {
    facebook: { name: 'Facebook' },
    instagram: { name: 'Instagram' }
  }
}))

import { SocialPublishWidget } from './SocialPublishWidget'

describe('SocialPublishWidget', () => {
  const defaultProps = {
    appId: 'test-app-id',
    publishId: 'test-publish-id',
    toolId: 'test-tool-id',
    conversationId: 'test-conversation-id',
    isLastAssistantMessage: false
  }

  const basePendingPublish = {
    platform: 'facebook',
    message: 'Test post message',
    publishId: 'test-publish-id'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('history detection - prevents duplicate publish', () => {
    it('should NOT run publish flow when loaded from history (publishStatus exists)', async () => {
      const historyResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Success,
        publishResult: { platformUrl: 'https://facebook.com/post/123' }
      }

      renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={historyResult}
        />
      )

      await waitFor(() => {
        expect(mockUsePublishFlow).toHaveBeenCalled()
      })

      const lastCall = mockUsePublishFlow.mock.calls[mockUsePublishFlow.mock.calls.length - 1]
      const isActiveFlow = lastCall[3]

      expect(isActiveFlow).toBe(false)
    })

    it('should run publish flow when loaded fresh (no publishStatus)', async () => {
      const freshResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' }
      }

      renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={freshResult}
          isLastAssistantMessage={true}
        />
      )

      await waitFor(() => {
        expect(mockUsePublishFlow).toHaveBeenCalled()
      })

      const lastCall = mockUsePublishFlow.mock.calls[mockUsePublishFlow.mock.calls.length - 1]
      const isActiveFlow = lastCall[3]

      expect(isActiveFlow).toBe(true)
    })

    it('should NOT run publish flow when history has Error status', async () => {
      const errorHistoryResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Error,
        publishResult: { error: 'Failed to publish' }
      }

      renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={errorHistoryResult}
        />
      )

      await waitFor(() => {
        expect(mockUsePublishFlow).toHaveBeenCalled()
      })

      const lastCall = mockUsePublishFlow.mock.calls[mockUsePublishFlow.mock.calls.length - 1]
      const isActiveFlow = lastCall[3]

      expect(isActiveFlow).toBe(false)
    })

    it('should NOT run publish flow when history has Publishing status', async () => {
      const publishingHistoryResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Publishing,
        publishResult: null
      }

      renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={publishingHistoryResult}
        />
      )

      await waitFor(() => {
        expect(mockUsePublishFlow).toHaveBeenCalled()
      })

      const lastCall = mockUsePublishFlow.mock.calls[mockUsePublishFlow.mock.calls.length - 1]
      const isActiveFlow = lastCall[3]

      expect(isActiveFlow).toBe(false)
    })

    it('should run publish flow after refresh when last message and ReadyToPublish', async () => {
      // Regression test: After page refresh, if publish widget is the last message
      // and in ReadyToPublish state, it should run the flow (not get stuck)
      const refreshedResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.ReadyToPublish // May exist from incomplete attempt
      }

      renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={refreshedResult}
          isLastAssistantMessage={true} // Last message after refresh
        />
      )

      await waitFor(() => {
        expect(mockUsePublishFlow).toHaveBeenCalled()
      })

      const lastCall = mockUsePublishFlow.mock.calls[mockUsePublishFlow.mock.calls.length - 1]
      const isActiveFlow = lastCall[3]

      // Should run the flow even though result has publishStatus
      expect(isActiveFlow).toBe(true)
    })
  })

  describe('Read-only history rendering', () => {
    it('should render nothing when no pendingPublish data', () => {
      const emptyResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id'
      }

      const { container } = renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={emptyResult}
        />
      )

      expect(container.firstChild).toBeNull()
    })

    it('renders read-only success message with View Post button when from history', async () => {
      const successResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Success,
        publishResult: { platformUrl: 'https://facebook.com/post/123' }
      }

      const { container } = renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={successResult}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
        expect(screen.getByText('builder_widgets_socialpublish_live_on')).toBeInTheDocument()
      })

      const button = screen.getByRole('link', { name: 'builder_widgets_socialpublish_view_post' })
      expect(button).toBeInTheDocument()
      expect(button).toHaveAttribute('href', 'https://facebook.com/post/123')

      const box = container.querySelector('.border-intents-ux-success-borderColor')
      expect(box).toBeInTheDocument()
    })

    it('renders read-only error message without button when from history', async () => {
      const errorResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Error,
        publishResult: { error: 'Invalid access token' }
      }

      const { container } = renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={errorResult}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('builder_widgets_socialpublish_failed')).toBeInTheDocument()
        expect(screen.getByText('Invalid access token')).toBeInTheDocument()
      })

      expect(screen.queryByRole('link', { name: 'builder_widgets_socialpublish_view_post' })).not.toBeInTheDocument()

      const box = container.querySelector('.border-intents-ux-error-borderColor')
      expect(box).toBeInTheDocument()
    })

    it('renders incomplete status for transient states in history', async () => {
      const publishingResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Publishing,
        publishResult: null
      }

      const { container } = renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={publishingResult}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('builder_widgets_socialpublish_incomplete')).toBeInTheDocument()
      })

      const box = container.querySelector('.border-intents-ux-info-borderColor')
      expect(box).toBeInTheDocument()
    })

    it('does not show spinner when rendering read-only view', async () => {
      const successResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: basePendingPublish,
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Success,
        publishResult: { platformUrl: 'https://facebook.com/post/123' }
      }

      const { container } = renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={successResult}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('builder_widgets_socialpublish_success')).toBeInTheDocument()
      })

      const spinner = container.querySelector('.ux-spinner')
      expect(spinner).not.toBeInTheDocument()
    })

    it('uses correct platform name in read-only view', async () => {
      const instagramResult = {
        action: 'publish',
        appId: 'test-app-id',
        publishId: 'test-publish-id',
        pendingPublish: { ...basePendingPublish, platform: 'instagram' },
        postData: { id: 'post-1' },
        publishStatus: PublishFlowState.Success,
        publishResult: { platformUrl: 'https://instagram.com/p/123' }
      }

      renderWithProviders(
        <SocialPublishWidget
          {...defaultProps}
          initialResult={instagramResult}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('builder_widgets_socialpublish_live_on')).toBeInTheDocument()
      })
    })
  })
})
