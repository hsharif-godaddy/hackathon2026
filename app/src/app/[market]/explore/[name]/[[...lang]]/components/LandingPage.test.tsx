/**
 * @vitest-environment jsdom
 */
import { useRouter, useSearchParams } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useAuthContext } from '@/components/providers/AuthProvider'
import { fetchQuickCreate } from '@/lib/quick-create'
import { logger } from '@/lib/request-context'
import { useAuthUIStore } from '@/stores/useAuthUIStore'
import { logImpressionEvent } from '@/utils/instrumentation'
import LandingPage from './LandingPage'
import type { LandingPageData } from './types'

const MockAuthDismissedError = vi.hoisted(() => class AuthDismissedError extends Error {
  constructor() {
    super('Authentication dismissed')
    this.name = 'AuthDismissedError'
  }
})

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(),
}))

vi.mock('@/lib/quick-create', () => ({
  fetchQuickCreate: vi.fn(),
  buildDevelopUrl: vi.fn((id: string, type: string) => type === 'job' ? `/develop/${id}?type=job` : `/develop/${id}`),
  setQuickCreateSessionFlags: vi.fn(),
  extractApiError: (e: unknown) => e,
}))

vi.mock('@/lib/gasket-config', () => ({ AuthDismissedError: MockAuthDismissedError }))

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: vi.fn(),
}))

vi.mock('@/hooks/useSsoSignIn', () => ({
  useSsoSignIn: () => ({ signIn: vi.fn() }),
}))

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(() => ({ subscriptions: [], isLoading: false, isError: false })),
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/hooks/useSafariClass', () => ({
  useSafariClass: () => undefined,
}))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/paywall/shared', () => ({
  landingItc: vi.fn(() => null),
}))

vi.mock('@/lib/itc', () => ({
  setItcOverride: vi.fn(),
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}))

vi.mock('./LandingHero', () => ({
  default: ({ onStartBuilding, setPromptText }: { onStartBuilding: () => void; setPromptText: (t: string) => void }) => (
    <>
      <button data-testid="set-prompt" onClick={() => setPromptText('build me a game')}>Set</button>
      <button data-testid="submit-btn" onClick={onStartBuilding}>Submit</button>
    </>
  ),
}))

vi.mock('./SectionRenderer', () => ({ default: () => null }))

vi.mock('@/components/auth/MockLogin', () => ({ MockLoginDialog: () => null }))
vi.mock('@/components/layout/ExploreFooter', () => ({ default: () => null }))
vi.mock('@/components/layout/Header', () => ({ default: () => null }))

const MINIMAL_DATA: LandingPageData = {
  route: { language: 'en', name: 'games', label: 'Games', useCase: 'games' },
  meta: { title: 'Games', description: 'Build games' },
  header: { location: 'games' },
  hero: { title: 'Build a game', subtitle: 'Fast', placeholders: [], examples: [] },
  sections: [],
  theme: { backgroundGradient: '' },
}

describe('LandingPage', () => {
  const mockRouter = { push: vi.fn(), replace: vi.fn() }
  const mockSearchParams = { get: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRouter as any).mockReturnValue(mockRouter)
    ;(useSearchParams as any).mockReturnValue(mockSearchParams)
    ;(useAuthContext as any).mockReturnValue({ isAuthenticated: true, isLoading: false })
    ;(useAuthUIStore as any).mockImplementation((selector: any) =>
      selector({ setRedirectUrl: vi.fn(), ssoCloseReason: null })
    )
    mockSearchParams.get.mockReturnValue(null)
    ;(fetchQuickCreate as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'job-abc', type: 'job', status: 'creating', account_id: 'acc1' }),
    })
  })

  it('fires logImpressionEvent homepage.redirect.develop with entryPoint on successful create', async () => {
    const { getByTestId } = render(<LandingPage data={MINIMAL_DATA} />)

    await userEvent.click(getByTestId('set-prompt'))
    await userEvent.click(getByTestId('submit-btn'))

    await waitFor(() => {
      expect(logImpressionEvent).toHaveBeenCalledWith(
        'homepage.redirect.develop',
        { entry_point: 'aab_landing_page' }
      )
    })
  })

  it('uses location param as entryPoint when present', async () => {
    mockSearchParams.get.mockImplementation((key: string) =>
      key === 'location' ? 'godaddy.com/games' : null
    )

    const { getByTestId } = render(<LandingPage data={MINIMAL_DATA} />)

    await userEvent.click(getByTestId('set-prompt'))
    await userEvent.click(getByTestId('submit-btn'))

    await waitFor(() => {
      expect(logImpressionEvent).toHaveBeenCalledWith(
        'homepage.redirect.develop',
        { entry_point: 'godaddy.com/games' }
      )
    })
  })

  it('redirects to develop after successful create', async () => {
    const { getByTestId } = render(<LandingPage data={MINIMAL_DATA} />)

    await userEvent.click(getByTestId('set-prompt'))
    await userEvent.click(getByTestId('submit-btn'))

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/develop/job-abc?type=job')
    })
  })

  it('does not fire EID when API returns 401', async () => {
    ;(fetchQuickCreate as any).mockResolvedValue({ ok: false, status: 401 })

    const { getByTestId } = render(<LandingPage data={MINIMAL_DATA} />)

    await userEvent.click(getByTestId('set-prompt'))
    await userEvent.click(getByTestId('submit-btn'))

    await waitFor(() => {
      expect(fetchQuickCreate).toHaveBeenCalled()
    })

    expect(logImpressionEvent).not.toHaveBeenCalledWith(
      'homepage.redirect.develop',
      expect.anything()
    )
    expect(mockRouter.push).not.toHaveBeenCalled()
  })

  it('resets loading without logging an error when auth recovery is dismissed', async () => {
    ;(fetchQuickCreate as any).mockRejectedValue(new MockAuthDismissedError())

    const { getByTestId } = render(<LandingPage data={MINIMAL_DATA} />)

    await userEvent.click(getByTestId('set-prompt'))
    await userEvent.click(getByTestId('submit-btn'))

    await waitFor(() => {
      expect(fetchQuickCreate).toHaveBeenCalled()
    })

    expect(logger.info).toHaveBeenCalledWith('landing.auth-dismissed', expect.objectContaining({ landingSlug: 'games' }))
    expect(logger.error).not.toHaveBeenCalledWith('landing.start_building.failed', expect.any(Object))
    expect(mockRouter.push).not.toHaveBeenCalled()
  })
})
