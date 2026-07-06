/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'

import { AuthStatus } from '@/hooks/social/connect-flow/useAuthPopup'
import { useSocialConnectFlowOrchestrator } from '@/hooks/social/connect-flow/useSocialConnectFlowOrchestrator'
import { FlowStep } from '@/hooks/social/connect-flow/useSocialConnectFlowStateMachine'
import { renderHookWithProviders } from '@/tests/test-utils'
import { SocialFlowAction } from '@/types/social'

const mockDispatch = vi.fn()

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/hooks/useFullscreen', () => ({
  useIsFullscreen: () => false,
}))

vi.mock('@/hooks/social/connect-flow/useSocialConnectFlowStateMachine', () => ({
  FlowStep: {
    SelectExisting: 'select_existing',
    Auth: 'auth',
    ValidatingPermissions: 'validating_permissions',
    FetchingPages: 'fetching_pages',
    SelectingPage: 'selecting_page',
    CreatingConnection: 'creating_connection',
    Complete: 'complete',
    Error: 'error',
  },
  useSocialConnectFlowStateMachine: () => ({
    state: {
      step: FlowStep.SelectExisting,
      showSelectExisting: true,
      forceNewConnection: false,
      userTokenId: '',
      pageTokens: [],
      retryCount: 0,
      isRetryable: false,
      maxRetries: 3,
    },
    dispatch: mockDispatch,
  }),
}))

vi.mock('@/hooks/social/connect-flow/useSocialConnectFlow', () => ({
  useSocialConnectFlow: () => ({
    isLoading: false,
    availableConnections: [],
    enrichedConnections: [],
    currentSiteLink: undefined,
    linkedConnection: undefined,
    isLoadingMetadata: false,
    connectionsLoadingMetadata: new Set<string>(),
  }),
}))

vi.mock('@/hooks/social/connect-flow/useSocialOAuthFlow', () => ({
  useSocialOAuthFlow: () => ({
    authUrl: undefined,
    isLoadingAuthUrl: false,
    authUrlError: null,
    isValidatingPermissions: false,
    platformPages: [],
    isPagesLoading: false,
  }),
}))

vi.mock('@/hooks/social/connect-flow/useAuthPopup', () => ({
  AuthStatus: {
    Pending: 'pending',
    Success: 'success',
    Error: 'error',
  },
  useAuthPopup: () => ({
    authStatus: AuthStatus.Pending,
    errorMessage: null,
    openPopup: vi.fn(),
  }),
}))

vi.mock('@/hooks/social/mutations/useCreateAndLinkConnection', () => ({
  useCreateAndLinkConnection: () => ({
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/hooks/social/mutations/useLinkConnection', () => ({
  useLinkConnection: () => ({
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('@/hooks/social/connect-flow/useSocialFlowEffects', () => ({
  useAutoSkipSelectionEffect: vi.fn(),
}))

describe('useSocialConnectFlowOrchestrator', function orchestratorTests() {
  const defaultProps = {
    platform: 'facebook',
    appId: 'app-123',
    state: 'oauth-state',
    isActive: true,
    onClose: vi.fn(),
  }

  beforeEach(function resetMocks() {
    vi.clearAllMocks()
  })

  it('calls onOpenSocialFlowsConnect for facebook instead of StartOAuth', function facebookHandoff() {
    const onOpenSocialFlowsConnect = vi.fn()
    const { result } = renderHookWithProviders(() =>
      useSocialConnectFlowOrchestrator({
        ...defaultProps,
        onOpenSocialFlowsConnect,
      })
    )

    act(function connectNew() {
      result.current.handlers.handleConnectNew()
    })

    expect(onOpenSocialFlowsConnect).toHaveBeenCalledTimes(1)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('calls onOpenSocialFlowsConnect for instagram and google', function otherSocialFlowsPlatforms() {
    const onOpenSocialFlowsConnect = vi.fn()

    const { result: instagramResult } = renderHookWithProviders(() =>
      useSocialConnectFlowOrchestrator({
        ...defaultProps,
        platform: 'instagram',
        onOpenSocialFlowsConnect,
      })
    )

    act(function connectInstagram() {
      instagramResult.current.handlers.handleConnectNew()
    })

    expect(onOpenSocialFlowsConnect).toHaveBeenCalledTimes(1)
    expect(mockDispatch).not.toHaveBeenCalled()

    mockDispatch.mockClear()
    onOpenSocialFlowsConnect.mockClear()

    const { result: googleResult } = renderHookWithProviders(() =>
      useSocialConnectFlowOrchestrator({
        ...defaultProps,
        platform: 'google',
        onOpenSocialFlowsConnect,
      })
    )

    act(function connectGoogle() {
      googleResult.current.handlers.handleConnectNew()
    })

    expect(onOpenSocialFlowsConnect).toHaveBeenCalledTimes(1)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('dispatches StartOAuth when handoff callback is absent', function missingHandoffCallback() {
    const { result } = renderHookWithProviders(() =>
      useSocialConnectFlowOrchestrator(defaultProps)
    )

    act(function connectNew() {
      result.current.handlers.handleConnectNew()
    })

    expect(mockDispatch).toHaveBeenCalledWith({ type: SocialFlowAction.StartOAuth })
  })

  it('dispatches StartOAuth for non-social-flows platforms', function legacyPlatformOAuth() {
    const onOpenSocialFlowsConnect = vi.fn()
    const { result } = renderHookWithProviders(() =>
      useSocialConnectFlowOrchestrator({
        ...defaultProps,
        platform: 'tiktok',
        onOpenSocialFlowsConnect,
      })
    )

    act(function connectNew() {
      result.current.handlers.handleConnectNew()
    })

    expect(onOpenSocialFlowsConnect).not.toHaveBeenCalled()
    expect(mockDispatch).toHaveBeenCalledWith({ type: SocialFlowAction.StartOAuth })
  })
})
