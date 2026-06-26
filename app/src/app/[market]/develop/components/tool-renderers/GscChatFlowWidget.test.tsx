/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithProviders } from '@/tests/test-utils'
import { GscChatFlowWidget } from './GscChatFlowWidget'

const mockSetupVerificationAfterAuth = vi.fn()
const mockVerifyAndLink = vi.fn()
const mockPublishMutate = vi.fn()
let capturedAuthSuccess: ((data: Record<string, unknown>) => Promise<void>) | null = null
let mockPublishedUrl: string | null = 'https://example.com'

vi.mock('@/app/[market]/develop/hooks/usePublishedUrl', () => ({
  usePublishedUrl: () => mockPublishedUrl,
}))

vi.mock('@/hooks/social/useGscConnectFlow', () => ({
  useGscConnectFlow: () => ({
    setupVerificationAfterAuth: mockSetupVerificationAfterAuth,
    verifyAndLink: mockVerifyAndLink,
  }),
}))

vi.mock('@/hooks/social/queries/useSocialAuthUrl', () => ({
  useSocialAuthUrl: () => ({ data: { url: 'https://oauth.example.com' } }),
}))

vi.mock('@/hooks/social/connect-flow/useAuthPopup', () => ({
  AuthStatus: { Error: 'error' },
  useAuthPopup: (
    _url: string,
    _platform: string,
    _state: string,
    onSuccess: (data: Record<string, unknown>) => Promise<void>
  ) => {
    capturedAuthSuccess = onSuccess
    return { authStatus: null, errorMessage: null }
  },
}))

let mockPublishStoreError = false
let mockIsPublishing = false
const mockSetPublishError = vi.fn()

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: {
      publishStates: Record<string, { isPublishing: boolean; publishError: boolean }>
    }) => unknown) => selector({
      publishStates: {
        'test-app-id': {
          isPublishing: mockIsPublishing,
          publishError: mockPublishStoreError,
        },
      },
    }),
    {
      getState: () => ({
        setPublishError: mockSetPublishError,
      }),
    }
  ),
}))

vi.mock('@/hooks/usePublishApp', () => ({
  usePublishApp: () => ({
    mutate: mockPublishMutate,
    isPending: false,
  }),
}))

let mockMetadata: {
  googleVerificationToken?: string
  googleVerificationSiteUrl?: string
  googleVerificationUserTokenId?: string
} | undefined

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({ data: mockMetadata }),
  }
})

describe('GscChatFlowWidget', () => {
  const defaultProps = {
    appId: 'test-app-id',
    isActive: true,
    onComplete: vi.fn(),
    onError: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPublishMutate.mockReset()
    capturedAuthSuccess = null
    mockPublishedUrl = 'https://example.com'
    mockMetadata = {
      googleVerificationToken: 'token-abc',
      googleVerificationSiteUrl: 'https://example.com',
      googleVerificationUserTokenId: 'Platform#GOOGLE#TokenType#USER#123',
    }
    mockSetupVerificationAfterAuth.mockResolvedValue({
      googleVerificationToken: 'token-abc',
      googleVerificationSiteUrl: 'https://example.com',
      googleVerificationUserTokenId: 'Platform#GOOGLE#TokenType#USER#123',
    })
    mockVerifyAndLink.mockResolvedValue({ siteAdded: true })
    mockPublishStoreError = false
    mockIsPublishing = false
    mockSetPublishError.mockImplementation((appId: string, hasError: boolean) => {
      if (appId === 'test-app-id') {
        mockPublishStoreError = hasError
      }
    })
  })

  it('shows unpublished message when site has no published URL', () => {
    mockPublishedUrl = null

    renderWithProviders(<GscChatFlowWidget {...defaultProps} />)

    expect(screen.getByTestId('gsc-chat-flow-widget')).toBeInTheDocument()
    expect(screen.getByText(/Publish your site first to connect Google Search Console/i)).toBeInTheDocument()
  })

  it('shows connect button and does not auto-start OAuth on mount', () => {
    renderWithProviders(<GscChatFlowWidget {...defaultProps} />)

    expect(screen.getByRole('button', { name: /Connect Google Search Console/i })).toBeInTheDocument()
    expect(mockPublishMutate).not.toHaveBeenCalled()
  })

  it('disables connect button when widget is inactive', () => {
    renderWithProviders(<GscChatFlowWidget {...defaultProps} isActive={false} />)

    expect(screen.getByRole('button', { name: /Connect Google Search Console/i })).toBeDisabled()
  })

  it('handleAuthSuccess sets up verification and moves to tag-injected phase', async () => {
    const onTagInjected = vi.fn()
    renderWithProviders(<GscChatFlowWidget {...defaultProps} onTagInjected={onTagInjected} />)

    expect(capturedAuthSuccess).toBeTruthy()
    await capturedAuthSuccess!({ user_token: 'Platform#GOOGLE#TokenType#USER#123' })

    await waitFor(() => {
      expect(mockSetupVerificationAfterAuth).toHaveBeenCalledWith(
        'https://example.com',
        'Platform#GOOGLE#TokenType#USER#123'
      )
      expect(onTagInjected).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /Publish site/i })).toBeInTheDocument()
    })
  })
  it('surfaces setup failure when tag injection fails after OAuth', async () => {
    mockSetupVerificationAfterAuth.mockRejectedValue(new Error('inject failed'))
    const onError = vi.fn()
    renderWithProviders(<GscChatFlowWidget {...defaultProps} onError={onError} />)

    await capturedAuthSuccess!({ user_token: 'Platform#GOOGLE#TokenType#USER#123' })

    await waitFor(() => {
      expect(onError).toHaveBeenCalled()
      expect(screen.getByText(/Failed to set up verification/i)).toBeInTheDocument()
    })
  })

  it('handleVerify completes happy path', async () => {
    const onComplete = vi.fn()
    renderWithProviders(
      <GscChatFlowWidget
        {...defaultProps}
        initialPhase="tag-injected"
        onComplete={onComplete}
      />
    )

    fireEvent(
      window,
      new CustomEvent('publish-snapshot-request', { detail: { appId: 'test-app-id' } })
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Verify with Google/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Verify with Google/i }))

    await waitFor(() => {
      expect(mockVerifyAndLink).toHaveBeenCalled()
      expect(onComplete).toHaveBeenCalled()
      expect(screen.getByText(/Connected to Google Search Console/i)).toBeInTheDocument()
    })
  })

  it('handleVerify shows property list warning when siteAdded is false', async () => {
    mockVerifyAndLink.mockResolvedValue({ siteAdded: false })

    renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent(
      window,
      new CustomEvent('publish-snapshot-request', { detail: { appId: 'test-app-id' } })
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Verify with Google/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Verify with Google/i }))

    await waitFor(() => {
      expect(screen.getByText(/Connected to Google Search Console/i)).toBeInTheDocument()
      expect(screen.getByText(/could not be added to the Google Search Console property list/i)).toBeInTheDocument()
    })
  })

  it('handleVerify leaves retryable state on failure', async () => {
    mockVerifyAndLink.mockRejectedValue(new Error('verify failed'))

    renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent(
      window,
      new CustomEvent('publish-snapshot-request', { detail: { appId: 'test-app-id' } })
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Verify with Google/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Verify with Google/i }))

    await waitFor(() => {
      expect(screen.getByText(/Verification failed/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Verify with Google/i })).toBeInTheDocument()
    })
  })

  it('ignores publish-snapshot-request for a different appId', async () => {
    renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent(
      window,
      new CustomEvent('publish-snapshot-request', { detail: { appId: 'other-app' } })
    )

    expect(screen.getByRole('button', { name: /Publish site/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Verify with Google/i })).not.toBeInTheDocument()
  })

  it('surfaces publish failure from mutate onError', async () => {
    mockPublishMutate.mockImplementation((_params, options) => {
      options?.onError?.(new Error('publish failed'))
    })

    renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent.click(screen.getByRole('button', { name: /Publish site/i }))

    await waitFor(() => {
      expect(screen.getByText(/Publish failed/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Publish site/i })).toBeInTheDocument()
    })
  })

  it('surfaces publish failure from publish-snapshot-failed event', async () => {
    renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent.click(screen.getByRole('button', { name: /Publish site/i }))

    fireEvent(
      window,
      new CustomEvent('publish-snapshot-failed', { detail: { appId: 'test-app-id' } })
    )

    await waitFor(() => {
      expect(screen.getByText(/Publish failed/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Publish site/i })).toBeInTheDocument()
    })
  })

  it('surfaces publish failure when store publishError is set after publish click', async () => {
    const { rerender } = renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent.click(screen.getByRole('button', { name: /Publish site/i }))

    mockPublishStoreError = true
    rerender(<GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />)

    await waitFor(() => {
      expect(screen.getByText(/Publish failed/i)).toBeInTheDocument()
    })
  })

  it('does not surface stale store publishError when retrying publish', async () => {
    mockPublishStoreError = true

    renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent.click(screen.getByRole('button', { name: /Publish site/i }))

    expect(mockSetPublishError).toHaveBeenCalledWith('test-app-id', false)
    expect(screen.queryByText(/Publish failed/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Publish site/i })).toBeInTheDocument()
  })

  it('ignores publish-snapshot-failed when publish was not initiated from widget', async () => {
    renderWithProviders(
      <GscChatFlowWidget {...defaultProps} initialPhase="tag-injected" />
    )

    fireEvent(
      window,
      new CustomEvent('publish-snapshot-failed', { detail: { appId: 'test-app-id' } })
    )

    expect(screen.queryByText(/Publish failed/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Publish site/i })).toBeInTheDocument()
  })
})
