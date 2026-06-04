/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { logImpressionEvent } from '@/utils/instrumentation'
import { useHomepageSubmission } from './useHomepageSubmission'

const mockAuthContext = vi.hoisted(() => vi.fn(function () { return { isAuthenticated: true, isLoading: false }; }))
const mockUseSubscription = vi.hoisted(() => vi.fn(function () { return { subscriptions: [] as { id: string }[], isLoading: false, isError: false }; }))
const mockFetchQuickCreate = vi.hoisted(() => vi.fn())
const mockRouterPush = vi.hoisted(() => vi.fn())

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
  logClickEvent: vi.fn(function () { return vi.fn(); }),
  logAiroHQEvent: vi.fn(function () { return vi.fn(); }),
}))
vi.mock('@/lib/logging', () => ({ shipAnalyticsLog: vi.fn() }))
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/errors', () => ({ getErrorMessage: (e: unknown) => String(e) }))
vi.mock('@/lib/domain-validation', () => ({ validateDomainName: () => ({ valid: true }) }))
vi.mock('@/lib/waf-validation', () => ({
  validateAndClampPrompt: (text: string) => ({ text, wasClipped: false, charLength: text.length, byteLength: text.length }),
}))
vi.mock('@/lib/quick-create', () => ({
  fetchQuickCreate: (...args: unknown[]) => mockFetchQuickCreate(...args),
  buildDevelopUrl: () => '/develop/app-1',
  setQuickCreateSessionFlags: vi.fn(),
  storeUploadedFiles: vi.fn(),
  extractApiError: (e: unknown) => e,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}))
vi.mock('@/app/[market]/components/types', () => ({
  validateTemplate: () => null,
  LOGO_DESIGNER_TEMPLATE: 'logo-designer',
  HeroSectionRef: {},
}))
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => mockAuthContext(),
}))
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}))
vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: undefined, logAnalytics: vi.fn() }),
}))
vi.mock('@/hooks/useSsoSignIn', () => ({ useSsoSignIn: () => ({ signIn: vi.fn() }) }))
vi.mock('@/hooks/useSwitchboard', () => ({ useSwitchboard: () => false }))
vi.mock('@/hooks/useTranslations', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('@/hooks/useSafariClass', () => ({ useSafariClass: () => undefined }))
vi.mock('@/hooks/useAuthGateTracking', () => ({ useAuthGateTracking: () => undefined }))
vi.mock('@/hooks/useHomepageBounceTracking', () => ({
  useHomepageBounceTracking: () => ({ markEngaged: vi.fn() }),
}))

describe('useHomepageSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthContext.mockReturnValue({ isAuthenticated: true, isLoading: false })
    mockUseSubscription.mockReturnValue({ subscriptions: [], isLoading: false, isError: false })
    mockFetchQuickCreate.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'site-1', type: 'standard' }),
    })
  })

  describe('setUploadedFiles (handleFilesChange)', () => {
    const mockFile = { name: 'design.fig', content: 'abc', isDesignMd: false }
    const PREFILL = 'builder_design_file_upload_prompt_prefill'

    it('sets the files when files are provided', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile]) })

      expect(result.current.uploadedFiles).toEqual([mockFile])
    })

    it('populates promptText with prefill when prompt is empty', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile]) })

      expect(result.current.promptText).toBe(PREFILL)
    })

    it('does not overwrite promptText when prompt already has content', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setPromptText('my custom prompt') })
      act(() => { result.current.setUploadedFiles([mockFile]) })

      expect(result.current.promptText).toBe('my custom prompt')
    })

    it('clears the files when an empty array is provided', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile]) })
      act(() => { result.current.setUploadedFiles([]) })

      expect(result.current.uploadedFiles).toEqual([])
    })

    it('clears promptText when all files are removed and prompt is the prefill', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile]) })
      act(() => { result.current.setUploadedFiles([]) })

      expect(result.current.promptText).toBe('')
    })

    it('preserves promptText when all files are removed and user has custom text', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setPromptText('my custom prompt') })
      act(() => { result.current.setUploadedFiles([mockFile]) })
      act(() => { result.current.setUploadedFiles([]) })

      expect(result.current.promptText).toBe('my custom prompt')
    })

    it('preserves promptText when files are empty and prompt is empty', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([]) })

      expect(result.current.promptText).toBe('')
    })
  })

  describe('budget.newUser.eligible impression', () => {
    it('fires when user is new (no subscriptions)', async () => {
      mockUseSubscription.mockReturnValue({ subscriptions: [], isLoading: false, isError: false })

      const { result } = renderHook(() => useHomepageSubmission())

      await act(async () => {
        await result.current.handleStartBuilding('build me a site')
      })

      expect(logImpressionEvent).toHaveBeenCalledWith('budget.newUser.eligible')
    })

    it('does not fire when user has existing subscriptions', async () => {
      mockUseSubscription.mockReturnValue({ subscriptions: [{ id: 'sub-1' }], isLoading: false, isError: false })

      const { result } = renderHook(() => useHomepageSubmission())

      await act(async () => {
        await result.current.handleStartBuilding('build me a site')
      })

      expect(logImpressionEvent).not.toHaveBeenCalledWith('budget.newUser.eligible')
    })

    it('does not fire while subscriptions are loading', async () => {
      mockUseSubscription.mockReturnValue({ subscriptions: [], isLoading: true, isError: false })

      const { result } = renderHook(() => useHomepageSubmission())

      await act(async () => {
        await result.current.handleStartBuilding('build me a site')
      })

      expect(logImpressionEvent).not.toHaveBeenCalledWith('budget.newUser.eligible')
    })

    it('does not fire when subscriptions fetch fails', async () => {
      mockUseSubscription.mockReturnValue({
        subscriptions: [],
        isLoading: false,
        isError: true,
      })

      const { result } = renderHook(() => useHomepageSubmission())

      await act(async () => {
        await result.current.handleStartBuilding('build me a site')
      })

      expect(logImpressionEvent).not.toHaveBeenCalledWith('budget.newUser.eligible')
    })
  })
})
