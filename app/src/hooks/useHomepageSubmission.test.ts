/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, type Mock,vi } from 'vitest'
import { presetForDirection } from '@airo/shared'
import { act, renderHook, waitFor } from '@testing-library/react'

import type { DesignKit } from '@/lib/design-kits'
import { setQuickCreateSessionFlags } from '@/lib/quick-create'
import {
  persistPendingDesignChoice,
  readDesignChoiceForId,
  readPendingDesignChoice,
} from '@/lib/rebuild-design-choice'
import { logImpressionEvent } from '@/utils/instrumentation'
import { useHomepageSubmission } from './useHomepageSubmission'

const mockAuthContext = vi.hoisted(() => vi.fn(function () { return { isAuthenticated: true, isLoading: false }; }))
const mockUseSubscription = vi.hoisted(() => vi.fn(function () { return { subscriptions: [] as { id: string }[], isLoading: false, isError: false }; }))
const mockFetchQuickCreate = vi.hoisted(() => vi.fn())
const mockRouterPush = vi.hoisted(() => vi.fn())
const mockT = vi.hoisted(() => vi.fn((key: string) => key))
const mockLogAnalytics = vi.hoisted(() => vi.fn())

// Mutable messages map + locale the mocked useIntl returns; tests set these per-case.
const mockIntlMessages = vi.hoisted(() => ({ value: {} as Record<string, string> }))
const mockIntlLocale = vi.hoisted(() => ({ value: 'en-US' }))
const mockSearchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('react-intl', () => ({
  useIntl: () => ({
    locale: mockIntlLocale.value,
    messages: mockIntlMessages.value,
    formatMessage: ({ id }: { id: string }) => mockIntlMessages.value[id] ?? id,
  }),
}))

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
  useSearchParams: () => ({
    get: (k: string) => mockSearchParams.value.get(k),
    toString: () => mockSearchParams.value.toString(),
  }),
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
  useAnalytics: () => ({ cohort: undefined, logAnalytics: mockLogAnalytics }),
}))
vi.mock('@/hooks/useSsoSignIn', () => ({ useSsoSignIn: () => ({ signIn: vi.fn() }) }))
vi.mock('@/hooks/useSwitchboard', () => ({ useSwitchboard: () => false }))
vi.mock('@/hooks/useTranslations', () => ({ useTranslations: () => mockT }))
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
    mockSearchParams.value = new URLSearchParams()
    mockIntlMessages.value = {}
    mockIntlLocale.value = 'en-US'
  })

  describe('setUploadedFiles (handleFilesChange)', () => {
    const mockFile = { name: 'design.fig', content: 'abc', isDesignMd: false }
    // The translation key (first arg to t). The mock echoes it as the message.
    const PREFILL = 'builder_design_file_upload_prompt_prefill'
    // The text actually injected: the hook appends a trailing space when the
    // translation lacks one (the mock's echoed key has none).
    const PREFILL_TEXT = `${PREFILL} `

    it('sets the files when files are provided', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile]) })

      expect(result.current.uploadedFiles).toEqual([mockFile])
    })

    it('populates promptText with prefill when prompt is empty', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile]) })

      expect(result.current.promptText).toBe(PREFILL_TEXT)
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

    it('passes the file count to the prefill translation for ICU pluralization', () => {
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile, mockFile]) })

      expect(mockT).toHaveBeenCalledWith(PREFILL, { count: 2 }, expect.stringContaining('plural'))
    })

    it('refreshes the prefill when the file count changes and prompt is still the prefill', () => {
      // The mock t() echoes the key, so prefill text is identical across counts;
      // this asserts the count change does not get blocked as if it were user text.
      const { result } = renderHook(() => useHomepageSubmission())

      act(() => { result.current.setUploadedFiles([mockFile]) })
      act(() => { result.current.setUploadedFiles([mockFile, mockFile]) })

      expect(result.current.promptText).toBe(PREFILL_TEXT)
      expect(mockT).toHaveBeenCalledWith(PREFILL, { count: 2 }, expect.any(String))
    })
  })

  // Deep-link prefill behavior (initialPromptKey/initialPrompt, the prefill
  // impression, dedupe, CTA-text contract) is covered in useDeeplinkPromptPrefill.test.ts.
  // The integration check below stays here because submit_attempt is built by the parent.

  describe('submit_attempt matches main (no attribution)', () => {
    beforeEach(() => {
      mockSearchParams.value = new URLSearchParams()
      mockIntlMessages.value = {}
      localStorage.clear()
    })

    it('carries only submitSource, promptLength, msFromPageLoad (no itc/itcSource/initialPromptKey)', async () => {
      mockAuthContext.mockReturnValue({ isAuthenticated: true, isLoading: false })
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=logo&itc_source=email&itc=fooitc')

      const { result } = renderHook(() => useHomepageSubmission())
      await act(async () => { await result.current.handleStartBuilding() })

      const submitCall = mockLogAnalytics.mock.calls.find(c => c[0] === 'homepage.prompt.submit_attempt')
      expect(submitCall).toBeDefined()
      const payload = submitCall![1] as Record<string, unknown>
      expect(payload).not.toHaveProperty('initialPromptKey')
      expect(payload).not.toHaveProperty('itcSource')
      expect(payload).not.toHaveProperty('itc')
      expect(payload).toHaveProperty('submitSource')
      expect(payload).toHaveProperty('promptLength')
      expect(payload).toHaveProperty('msFromPageLoad')
    })
  })

  describe('rebuild design-choice promotion', () => {
    beforeEach(() => {
      sessionStorage.clear()
    })

    it('promotes a pending design choice onto the site id after quick-create', async () => {
      persistPendingDesignChoice(presetForDirection('modernize'))

      const { result } = renderHook(() => useHomepageSubmission())
      await act(async () => { await result.current.handleStartBuilding('rebuild my site') })

      // Pending cleared; choice keyed under the resolved site id.
      expect(readPendingDesignChoice()).toBeNull()
      expect(readDesignChoiceForId('site-1', null)).toEqual(presetForDirection('modernize'))
    })

    it('is a no-op when there is no pending choice', async () => {
      const { result } = renderHook(() => useHomepageSubmission())
      await act(async () => { await result.current.handleStartBuilding('build me a site') })

      expect(readDesignChoiceForId('site-1', null)).toBeNull()
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

  // AIROBUILD-2072: a logged-out user who attaches a kit and submits must not lose it
  // through the sign-in gate. Mirrors the airo-pending-fqdn persist/restore.
  describe('attached design kit survives the sign-in gate', () => {
    const KIT: DesignKit = {
      slug: 'golden-hour', displayName: 'Golden Hour', whenToUse: '', tags: [], thumbnailUrl: '',
    }

    beforeEach(() => { localStorage.clear() })

    it('persists the attached kit slug when the auth gate is shown (logged out)', async () => {
      mockAuthContext.mockReturnValue({ isAuthenticated: false, isLoading: false })
      const { result } = renderHook(() => useHomepageSubmission())
      act(() => { result.current.setAttachedKit(KIT) })

      await act(async () => { await result.current.handleStartBuilding('build me a site') })

      expect(localStorage.getItem('airo-pending-design-kit')).toBe('golden-hour')
    })

    it('does not persist a slug when no kit is attached (flag-off / no selection)', async () => {
      mockAuthContext.mockReturnValue({ isAuthenticated: false, isLoading: false })
      const { result } = renderHook(() => useHomepageSubmission())

      await act(async () => { await result.current.handleStartBuilding('build me a site') })

      expect(localStorage.getItem('airo-pending-design-kit')).toBeNull()
    })

    it('restores the saved slug after login and forwards it to quick-create', async () => {
      // Post-login remount: attachedKit state is null, so the slug must come from storage.
      localStorage.setItem('airo-pending-prompt', 'build me a site')
      localStorage.setItem('airo-pending-design-kit', 'golden-hour')

      renderHook(() => useHomepageSubmission())

      const flagsMock = setQuickCreateSessionFlags as unknown as Mock
      await waitFor(() => { expect(flagsMock).toHaveBeenCalled() })
      // The options object (4th arg) must carry the restored slug.
      expect(flagsMock.mock.calls.some(c => c[3]?.designKitSlug === 'golden-hour')).toBe(true)
      // Consumed, so a later submit can't replay a stale kit.
      expect(localStorage.getItem('airo-pending-design-kit')).toBeNull()
    })
  })

  describe('homepage.redirect.develop impression', () => {
    it('includes entryPoint in both data and impressionProps when location param is present', async () => {
      mockSearchParams.value = new URLSearchParams('location=godaddy.com%2Fhosting')

      const { result } = renderHook(() => useHomepageSubmission())
      await act(async () => { await result.current.handleStartBuilding('build me a site') })

      const call = mockLogAnalytics.mock.calls.find(c => c[0] === 'homepage.redirect.develop')
      expect(call).toBeDefined()
      expect(call![1]).toMatchObject({ entryPoint: 'godaddy.com/hosting' })
      expect(call![2]).toMatchObject({ impressionProps: { entry_point: 'godaddy.com/hosting' } })
    })

    it('falls back to aab_homepage in both data and impressionProps when no location params', async () => {
      mockSearchParams.value = new URLSearchParams()

      const { result } = renderHook(() => useHomepageSubmission())
      await act(async () => { await result.current.handleStartBuilding('build me a site') })

      const call = mockLogAnalytics.mock.calls.find(c => c[0] === 'homepage.redirect.develop')
      expect(call).toBeDefined()
      expect(call![1]).toMatchObject({ entryPoint: 'aab_homepage' })
      expect(call![2]).toMatchObject({ impressionProps: { entry_point: 'aab_homepage' } })
    })
  })

})
