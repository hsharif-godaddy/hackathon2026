/**
 * @vitest-environment jsdom
 */
import { useRouter, useSearchParams } from 'next/navigation'
import { beforeEach,describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import { useAuthContext } from '@/components/providers/AuthProvider'
import { createSiteAndRedirect } from '@/lib/site-creation'
import { useAuthUIStore } from '@/stores/useAuthUIStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import CreatePage from './page'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(),
}))

vi.mock('@/lib/site-creation', () => ({
  createSiteAndRedirect: vi.fn(),
}))

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: vi.fn(),
}))

// useSsoSignIn is the single env gate (see useSsoSignIn.ts); stub it so this
// test does not need to wire up AuthProvider. The signIn() stub forwards to
// openSsoLogin to preserve the existing assertion surface.
const mockSignIn = vi.fn()
vi.mock('@/hooks/useSsoSignIn', () => ({
  useSsoSignIn: () => ({ signIn: mockSignIn }),
}))

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({ subscriptions: [], isLoading: false, isError: false })),
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}))

describe('CreatePage', () => {
  const mockRouter = {
    replace: vi.fn(),
    push: vi.fn(),
  }

  const mockSearchParams = {
    get: vi.fn(),
  }

  const mockOpenSsoLogin = vi.fn()
  const mockSetRedirectUrl = vi.fn()
  const mockClearSsoCloseReason = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRouter as any).mockReturnValue(mockRouter)
    ;(useSearchParams as any).mockReturnValue(mockSearchParams)
    ;(useAuthContext as any).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    })
    ;(useAuthUIStore as any).mockImplementation(function (selector: any) {
      const store = {
        openSsoLogin: mockOpenSsoLogin,
        setRedirectUrl: mockSetRedirectUrl,
        ssoCloseReason: null,
        clearSsoCloseReason: mockClearSsoCloseReason,
      }
      return selector(store)
    })
  })

  it('redirects to homepage when initialPrompt is missing', async () => {
    mockSearchParams.get.mockReturnValue(null)

    render(<CreatePage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })
  })

  it('redirects to homepage when initialPrompt is empty', async () => {
    mockSearchParams.get.mockReturnValue('   ')

    render(<CreatePage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })
  })

  it('calls createSiteAndRedirect with correct params', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      return null
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test prompt',
          source: 'create-page',
          templateId: undefined,
        }),
        mockRouter
      )
    })
  })

  it('triggers SSO when API returns 401', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      return null
    })
    let onAuthRequiredCallback: any

    ;(createSiteAndRedirect as any).mockImplementation(function (options: any) {
      onAuthRequiredCallback = options.onAuthRequired
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalled()
    })

    // Trigger the onAuthRequired callback
    onAuthRequiredCallback('test prompt')

    expect(mockSetRedirectUrl).toHaveBeenCalledWith('/create?initialPrompt=test+prompt')
    expect(mockSignIn).toHaveBeenCalledWith({ redirectUrl: '/create?initialPrompt=test+prompt' })
  })

  it('passes templateId to createSiteAndRedirect when template param is present', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      if (key === 'template') return 'logo-designer'
      return null
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test prompt',
          source: 'create-page',
          templateId: 'logo-designer',
        }),
        mockRouter
      )
    })
  })

  it('passes templateId to createSiteAndRedirect when mode param is present', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      if (key === 'mode') return 'logo-designer'
      return null
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test prompt',
          source: 'create-page',
          templateId: 'logo-designer',
        }),
        mockRouter
      )
    })
  })

  it('treats template=default as no template', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      if (key === 'template') return 'default'
      return null
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test prompt',
          source: 'create-page',
          templateId: undefined,
        }),
        mockRouter
      )
    })
  })

  it('ignores invalid template param', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      if (key === 'template') return 'not-a-real-template'
      return null
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test prompt',
          source: 'create-page',
          templateId: undefined,
        }),
        mockRouter
      )
    })
  })

  it('emits mode param in redirect URL when legacy template param is present on auth required', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      if (key === 'template') return 'logo-designer'
      return null
    })
    let onAuthRequiredCallback: any

    ;(createSiteAndRedirect as any).mockImplementation(function (options: any) {
      onAuthRequiredCallback = options.onAuthRequired
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalled()
    })

    onAuthRequiredCallback('test prompt')

    expect(mockSetRedirectUrl).toHaveBeenCalledWith(
      '/create?initialPrompt=test+prompt&mode=logo-designer'
    )
    expect(mockSignIn).toHaveBeenCalledWith({
      redirectUrl: '/create?initialPrompt=test+prompt&mode=logo-designer',
    })
  })

  it('preserves itc param in redirect URL on auth required', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      if (key === 'itc') return 'build_for_free'
      return null
    })
    let onAuthRequiredCallback: any

    ;(createSiteAndRedirect as any).mockImplementation(function (options: any) {
      onAuthRequiredCallback = options.onAuthRequired
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalled()
    })

    onAuthRequiredCallback('test prompt')

    expect(mockSetRedirectUrl).toHaveBeenCalledWith(
      '/create?initialPrompt=test+prompt&itc=build_for_free'
    )
    expect(mockSignIn).toHaveBeenCalledWith({
      redirectUrl: '/create?initialPrompt=test+prompt&itc=build_for_free',
    })
  })

  it('redirects to homepage on SSO dismiss', async () => {
    mockSearchParams.get.mockReturnValue('test prompt')

    // Mock SSO close reason as 'dismiss'
    ;(useAuthUIStore as any).mockImplementation(function (selector: any) {
      const store = {
        openSsoLogin: mockOpenSsoLogin,
        setRedirectUrl: mockSetRedirectUrl,
        ssoCloseReason: 'dismiss',
        clearSsoCloseReason: mockClearSsoCloseReason,
      }
      return selector(store)
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/?initialPrompt=test%20prompt')
      expect(mockClearSsoCloseReason).toHaveBeenCalled()
    })
  })

  it('redirects to homepage on create error', async () => {
    mockSearchParams.get.mockReturnValue('test prompt')
    let onErrorCallback: any

    ;(createSiteAndRedirect as any).mockImplementation(function (options: any) {
      onErrorCallback = options.onError
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalled()
    })

    // Trigger the onError callback
    onErrorCallback('Test error')

    expect(mockRouter.replace).toHaveBeenCalledWith('/?initialPrompt=test%20prompt')
  })

  it('fires logImpressionEvent with entryPoint on successful site creation', async () => {
    mockSearchParams.get.mockImplementation(function (key: string) {
      if (key === 'initialPrompt') return 'test prompt'
      return null
    })
    let onSuccessCallback: ((siteId: string, siteType: string) => void) | undefined

    ;(createSiteAndRedirect as any).mockImplementation(function (options: any) {
      onSuccessCallback = options.onSuccess
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalled()
    })

    onSuccessCallback?.('site123', 'site')

    expect(logImpressionEvent).toHaveBeenCalledWith(
      'homepage.redirect.develop',
      { entry_point: 'create_route' }
    )
  })

  it('renders spinner while loading', () => {
    mockSearchParams.get.mockReturnValue('test prompt')

    const { container } = render(<CreatePage />)

    // Check for spinner component
    const spinner = container.querySelector('svg')
    expect(spinner).toBeTruthy()
  })
})
