/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  getRenderConfig,
  RenderState,
} from '@/app/[market]/develop/components/social/connect-flow/social-connect-flow-render'
import { AuthStatus } from '@/hooks/social/connect-flow/useAuthPopup'
import { SocialPlatform } from '@/types/social'

vi.mock('@/app/[market]/develop/components/social/connect-flow/OpenSocialFlowsConnectEffect', () => ({
  OpenSocialFlowsConnectEffect: () => <div data-testid="open-social-flows-effect" />,
}))

vi.mock('@/app/[market]/develop/components/social/connect-flow/SocialFlowsConnectWidget', () => ({
  default: () => <div data-testid="social-flows-widget" />,
}))

vi.mock('@/app/[market]/develop/components/social/connect-flow/SocialAuthPrompt', () => ({
  SocialAuthPrompt: () => <div data-testid="social-auth-prompt" />,
}))

vi.mock('@/app/[market]/develop/components/social/connect-flow/SocialConnectFlowState', () => ({
  FlowStateType: {
    Loading: 'loading',
    Error: 'error',
    Success: 'success',
  },
  SocialConnectFlowState: () => <div data-testid="social-connect-flow-state" />,
}))

type RenderConfigParams = Parameters<typeof getRenderConfig>[0]

function buildOAuthPromptParams(
  overrides: Partial<RenderConfigParams> = {}
): RenderConfigParams {
  return {
    renderState: RenderState.OAuthPrompt,
    config: { name: 'Facebook', Icon: null },
    currentConnectionDetails: undefined,
    normalizedPlatform: SocialPlatform.FACEBOOK,
    enrichedPlatformConnections: [],
    isLoadingMetadata: false,
    connectionsLoadingMetadata: new Set<string>(),
    handleSelectExisting: vi.fn(),
    handleConnectNew: vi.fn(),
    handleChangeConnection: vi.fn(),
    platform: 'facebook',
    platformPages: [],
    handlePageSelection: vi.fn(),
    handleCancelSelection: vi.fn(),
    flowStateError: undefined,
    authPopupErrorMessage: null,
    authStatus: AuthStatus.Pending,
    openPopup: vi.fn(),
    isRetryable: false,
    authUrlError: null,
    isLoadingAuthUrl: false,
    appId: 'app-123',
    onSuccess: vi.fn(),
    t: (key: string) => key,
    ...overrides,
  }
}

describe('getRenderConfig', function getRenderConfigTests() {
  describe('OAuthPrompt', function oauthPromptTests() {
    it('renders handoff effect when onOpenSocialFlowsConnect is provided', function handoffEffect() {
      const { content } = getRenderConfig(
        buildOAuthPromptParams({
          onOpenSocialFlowsConnect: vi.fn(),
        })
      )

      render(<>{content}</>)

      expect(screen.getByTestId('open-social-flows-effect')).toBeInTheDocument()
      expect(screen.queryByTestId('social-flows-widget')).not.toBeInTheDocument()
    })

    it('renders embedded social-flows widget when handoff callback is absent', function embeddedWidget() {
      const { content } = getRenderConfig(
        buildOAuthPromptParams({
          onOpenSocialFlowsConnect: undefined,
        })
      )

      render(<>{content}</>)

      expect(screen.getByTestId('social-flows-widget')).toBeInTheDocument()
      expect(screen.queryByTestId('open-social-flows-effect')).not.toBeInTheDocument()
    })

    it('renders auth prompt for non-social-flows platforms', function legacyAuthPrompt() {
      const { content } = getRenderConfig(
        buildOAuthPromptParams({
          normalizedPlatform: SocialPlatform.TIKTOK,
          platform: 'tiktok',
          config: { name: 'TikTok', Icon: null },
          onOpenSocialFlowsConnect: vi.fn(),
        })
      )

      render(<>{content}</>)

      expect(screen.getByTestId('social-auth-prompt')).toBeInTheDocument()
      expect(screen.queryByTestId('open-social-flows-effect')).not.toBeInTheDocument()
      expect(screen.queryByTestId('social-flows-widget')).not.toBeInTheDocument()
    })
  })
})
