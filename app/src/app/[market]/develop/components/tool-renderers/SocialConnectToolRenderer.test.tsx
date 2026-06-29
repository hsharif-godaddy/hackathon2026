/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import SocialConnectToolRenderer from './SocialConnectToolRenderer'

const mockSendMessage = vi.fn()
const mockSyncResult = vi.fn().mockResolvedValue(true)

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({
    sendMessage: mockSendMessage
  })
}))

vi.mock('@/hooks/useToolResultSync', () => ({
  useToolResultSync: () => mockSyncResult
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: () => 'test-app-id'
}))

vi.mock('@/utils/social', () => ({
  formatPlatformName: (platform: string) => platform.charAt(0).toUpperCase() + platform.slice(1),
  formatHashtags: (hashtags: string[]) => hashtags.join(' ')
}))


vi.mock('@/app/[market]/develop/components/social/connect-flow/SocialConnectFlow', () => ({
  default: ({ isActive, onClose }: { isActive: boolean; onClose: () => void }) => (
    <div data-testid="social-connect-flow" data-active={isActive} data-has-onclose={typeof onClose === 'function'}>
      Social Connect Flow
    </div>
  )
}))

vi.mock('@/app/[market]/develop/components/tool-renderers/GscChatFlowWidget', () => ({
  GscChatFlowWidget: ({ isActive }: { isActive: boolean }) => (
    <div data-testid="gsc-chat-flow-widget" data-active={isActive}>
      GSC Flow Widget
    </div>
  )
}))

vi.mock('@/utils/social/format', () => ({
  formatPlatformName: (platform: string) => platform.charAt(0).toUpperCase() + platform.slice(1),
}))

describe('SocialConnectToolRenderer', () => {
  const baseProps = {
    toolStatus: 'completed' as const,
    toolId: 'test-tool-id',
    conversationId: 'test-conversation-id',
    isLastAssistantMessage: false,
    toolName: 'social_connect'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncResult.mockClear()
  })

  describe('History - Success State', () => {
    it('renders read-only success status when loaded from history', () => {
      const result = {
        action: 'connect',
        platform: 'facebook',
        appId: 'test-app-id',
        state: 'test-state',
        connectStatus: 'connected'
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
        />
      )

      expect(screen.getByText('builder_social_connected_to_platform')).toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })
  })

  describe('History - Error State', () => {
    it('renders read-only error status when loaded from history', () => {
      const result = {
        action: 'connect',
        platform: 'instagram',
        appId: 'test-app-id',
        state: 'test-state',
        connectStatus: 'error',
        errorMessage: 'Missing permissions'
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
        />
      )

      expect(screen.getByText('builder_social_failed_to_connect_platform')).toBeInTheDocument()
      expect(screen.getByText('Missing permissions')).toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })
  })

  describe('Incomplete State', () => {
    it('renders incomplete status when no connectStatus (user abandoned)', () => {
      const result = {
        action: 'connect',
        platform: 'google',
        appId: 'test-app-id',
        state: 'test-state'
        // No connectStatus - user abandoned
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
        />
      )

      expect(screen.getByText('builder_social_connection_incomplete_platform')).toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })
  })

  describe('Active Flow', () => {
    it('renders interactive flow for current message', () => {
      const result = {
        action: 'connect',
        platform: 'facebook',
        appId: 'test-app-id',
        state: 'test-state'
        // No connectStatus, but isLastAssistantMessage=true means active
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
          isLastAssistantMessage={true}
        />
      )

      const flow = screen.getByTestId('social-connect-flow')
      expect(flow).toBeInTheDocument()
      expect(flow).toHaveAttribute('data-active', 'true')
    })

    it('passes onClose to the connect flow', () => {
      const result = {
        action: 'connect',
        platform: 'facebook',
        appId: 'test-app-id',
        state: 'test-state'
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
          isLastAssistantMessage={true}
        />
      )

      const flow = screen.getByTestId('social-connect-flow')
      expect(flow).toHaveAttribute('data-has-onclose', 'true')
    })

    it('shows status message instead of flow when loaded from history', () => {
      const result = {
        action: 'connect',
        platform: 'facebook',
        appId: 'test-app-id',
        state: 'test-state',
        connectStatus: 'pending' // Has status but pending
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
          isLastAssistantMessage={false} // Not last message = from history
        />
      )

      // Should show incomplete status, NOT the flow component
      expect(screen.getByText('builder_social_connection_incomplete_platform')).toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })
  })

  describe('GSC Flow', () => {
    it('renders GscChatFlowWidget for active GSC connection request', () => {
      const result = {
        action: 'connect',
        platform: 'GOOGLE_SEARCH_CONSOLE',
        appId: 'test-app-id',
        state: 'test-state',
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
          isLastAssistantMessage={true}
        />
      )

      expect(screen.getByTestId('gsc-chat-flow-widget')).toBeInTheDocument()
      expect(screen.getByTestId('gsc-chat-flow-widget')).toHaveAttribute('data-active', 'true')
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })

    it('renders status message for GSC loaded from history', () => {
      const result = {
        action: 'connect',
        platform: 'GOOGLE_SEARCH_CONSOLE',
        appId: 'test-app-id',
        state: 'test-state',
        connectStatus: 'pending',
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
          isLastAssistantMessage={false}
        />
      )

      expect(screen.queryByTestId('gsc-chat-flow-widget')).not.toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
      expect(screen.getByText('builder_social_connection_incomplete_platform')).toBeInTheDocument()
    })

    it('renders GscChatFlowWidget when tag-injected is loaded from history', () => {
      const result = {
        action: 'connect',
        platform: 'GOOGLE_SEARCH_CONSOLE',
        appId: 'test-app-id',
        state: 'test-state',
        connectStatus: 'tag-injected',
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
          isLastAssistantMessage={false}
        />
      )

      expect(screen.getByTestId('gsc-chat-flow-widget')).toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })

    it('renders GscChatFlowWidget when verified is loaded from history', () => {
      const result = {
        action: 'connect',
        platform: 'GOOGLE_SEARCH_CONSOLE',
        appId: 'test-app-id',
        state: 'test-state',
        connectStatus: 'verified',
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
          isLastAssistantMessage={false}
        />
      )

      expect(screen.getByTestId('gsc-chat-flow-widget')).toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })
  })

  describe('Fallback', () => {
    it('renders DefaultToolRenderer when not a connect action', () => {
      const result = {
        action: 'other',
        platform: 'facebook'
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
        />
      )

      expect(screen.queryByText('builder_social_connected_to_platform')).not.toBeInTheDocument()
      expect(screen.queryByTestId('social-connect-flow')).not.toBeInTheDocument()
    })
  })

  describe('Tool Result Sync', () => {
    it('does not sync when loaded from history', async () => {
      const result = {
        action: 'connect',
        platform: 'facebook',
        appId: 'test-app-id',
        state: 'test-state',
        connectStatus: 'connected'
      }

      renderWithProviders(
        <SocialConnectToolRenderer
          {...baseProps}
          result={result}
        />
      )

      await waitFor(() => {
        expect(mockSyncResult).not.toHaveBeenCalled()
      })
    })
  })
})
