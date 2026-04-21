/**
 * @vitest-environment jsdom
 */
import { useRouter, useSearchParams } from 'next/navigation'
import { beforeEach,describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import { useAuthContext } from '@/components/providers/AuthProvider'
import { createSiteAndRedirect } from '@/lib/site-creation'
import { useAuthUIStore } from '@/stores/useAuthUIStore'
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

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
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
      isAuthDisabled: false,
      isLoading: false,
    })
    ;(useAuthUIStore as any).mockImplementation((selector: any) => {
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
    mockSearchParams.get.mockReturnValue('test prompt')

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'test prompt',
          source: 'create-page',
        }),
        mockRouter
      )
    })
  })

  it('triggers SSO when API returns 401', async () => {
    mockSearchParams.get.mockReturnValue('test prompt')
    let onAuthRequiredCallback: any

    ;(createSiteAndRedirect as any).mockImplementation((options: any) => {
      onAuthRequiredCallback = options.onAuthRequired
    })

    render(<CreatePage />)

    await waitFor(() => {
      expect(createSiteAndRedirect).toHaveBeenCalled()
    })

    // Trigger the onAuthRequired callback
    onAuthRequiredCallback('test prompt')

    expect(mockSetRedirectUrl).toHaveBeenCalledWith('/create?initialPrompt=test%20prompt')
    expect(mockOpenSsoLogin).toHaveBeenCalled()
  })

  it('redirects to homepage on SSO dismiss', async () => {
    mockSearchParams.get.mockReturnValue('test prompt')

    // Mock SSO close reason as 'dismiss'
    ;(useAuthUIStore as any).mockImplementation((selector: any) => {
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

    ;(createSiteAndRedirect as any).mockImplementation((options: any) => {
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

  it('renders spinner while loading', () => {
    mockSearchParams.get.mockReturnValue('test prompt')

    const { container } = render(<CreatePage />)

    // Check for spinner component
    const spinner = container.querySelector('svg')
    expect(spinner).toBeTruthy()
  })
})
