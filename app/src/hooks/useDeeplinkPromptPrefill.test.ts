/**
 * @vitest-environment jsdom
 */
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { logger } from '@/lib/request-context'
import { useDeeplinkPromptPrefill } from './useDeeplinkPromptPrefill'

const mockLogAnalytics = vi.hoisted(() => vi.fn())
const mockOnPrefill = vi.hoisted(() => vi.fn())

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
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (k: string) => mockSearchParams.value.get(k),
    toString: () => mockSearchParams.value.toString(),
  }),
}))
vi.mock('@/lib/waf-validation', () => ({
  validateAndClampPrompt: (text: string) => ({ text, wasClipped: false, charLength: text.length, byteLength: text.length }),
}))
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
// @/lib/deeplink-prompt and @/lib/itc are pure — exercised for real (not mocked).

// Renders the hook with spies; promptText defaults to '' (nothing set yet).
function render(promptText = '') {
  return renderHook(() =>
    useDeeplinkPromptPrefill({ promptText, onPrefill: mockOnPrefill, logAnalytics: mockLogAnalytics }),
  )
}

const prefillCalls = () => mockLogAnalytics.mock.calls.filter(c => c[0] === 'homepage.firstprompt.prefill')
const lastSetText = () => mockOnPrefill.mock.calls.at(-1)?.[0]

describe('useDeeplinkPromptPrefill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.value = new URLSearchParams()
    mockIntlMessages.value = {}
    mockIntlLocale.value = 'en-US'
  })

  describe('initialPromptKey prefill', () => {
    it('prefills the resolved message when the key exists in intl.messages', () => {
      mockIntlMessages.value = { builder_deeplink_prompt_hair_salon: 'Build a salon booking site' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=hair_salon')
      render()
      expect(lastSetText()).toBe('Build a salon booking site')
    })

    it('does NOT prefill (and never dumps the raw id) for an unknown key', () => {
      mockIntlMessages.value = {}
      mockSearchParams.value = new URLSearchParams('initialPromptKey=does_not_exist')
      render()
      expect(mockOnPrefill).not.toHaveBeenCalled()
    })

    it('does NOT prefill for a malformed suffix', () => {
      mockSearchParams.value = new URLSearchParams('initialPromptKey=Bad-Key')
      render()
      expect(mockOnPrefill).not.toHaveBeenCalled()
    })

    it('initialPromptKey wins when both initialPrompt and a valid key are present', () => {
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo and brand' }
      mockSearchParams.value = new URLSearchParams(
        'initialPrompt=' + encodeURIComponent('raw text prompt') + '&initialPromptKey=logo',
      )
      render()
      expect(lastSetText()).toBe('Create a logo and brand')
    })

    it('falls through to initialPrompt when the key is present but unknown', () => {
      mockIntlMessages.value = {}
      mockSearchParams.value = new URLSearchParams(
        'initialPrompt=' + encodeURIComponent('raw fallback') + '&initialPromptKey=missing',
      )
      render()
      expect(lastSetText()).toBe('raw fallback')
    })

    it('yields (does not clobber) when promptText is already set', () => {
      // Guard against overwriting text set elsewhere (saved-prompt restore, etc.).
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=logo')
      render('user already typed this')
      expect(mockOnPrefill).not.toHaveBeenCalled()
    })
  })

  describe('prefill_from_url matches main', () => {
    it('fires only { clipped, promptLength } on the raw path', () => {
      mockSearchParams.value = new URLSearchParams('initialPrompt=' + encodeURIComponent('raw text'))
      render()

      const call = mockLogAnalytics.mock.calls.find(c => c[0] === 'homepage.prompt.prefill_from_url')
      expect(call).toBeDefined()
      expect(call![1]).toEqual({ clipped: false, promptLength: 'raw text'.length })
      // No options arg (log-pipeline only — no impression beacon).
      expect(call![2]).toBeUndefined()
    })

    it('is NOT fired on the key path', () => {
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=logo')
      render()

      const call = mockLogAnalytics.mock.calls.find(c => c[0] === 'homepage.prompt.prefill_from_url')
      expect(call).toBeUndefined()
    })
  })

  describe('firstprompt.prefill impression', () => {
    it('key path fires the impression with prefillSource:key, initialPromptKey, locale', () => {
      mockIntlMessages.value = { builder_deeplink_prompt_hair_salon: 'Build a salon site' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=hair_salon&itc=fooitc&itc_source=email')
      render()

      expect(mockLogAnalytics).toHaveBeenCalledWith(
        'homepage.firstprompt.prefill',
        expect.objectContaining({
          prefillSource: 'key',
          initialPromptKey: 'hair_salon',
          itc: 'fooitc',
          itcSource: 'email',
          locale: 'en-US',
        }),
        expect.objectContaining({
          kind: 'impression',
          eid: 'homepage.firstprompt.prefill',
          impressionProps: expect.objectContaining({ prefillSource: 'key', initialPromptKey: 'hair_salon' }),
        }),
      )
    })

    it('raw path fires the impression with prefillSource:raw and no initialPromptKey', () => {
      mockSearchParams.value = new URLSearchParams('initialPrompt=' + encodeURIComponent('raw text'))
      render()

      const call = prefillCalls()[0]
      expect(call).toBeDefined()
      expect(call[1]).toMatchObject({ prefillSource: 'raw', locale: 'en-US' })
      expect(call[1]).not.toHaveProperty('initialPromptKey')
      expect(call[2]).toMatchObject({ kind: 'impression', eid: 'homepage.firstprompt.prefill' })
    })

    it('omits itc/itcSource when the params are absent', () => {
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=logo')
      render()

      const call = prefillCalls()[0]
      expect(call[1]).not.toHaveProperty('itc')
      expect(call[1]).not.toHaveProperty('itcSource')
    })

    it('omits itc/itcSource when present but invalid (validateItc wiring)', () => {
      // Space + bang fail validateItc's charset → must be dropped, not passed raw.
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo' }
      mockSearchParams.value = new URLSearchParams(
        'initialPromptKey=logo&itc=' + encodeURIComponent('bad value!') +
        '&itc_source=' + encodeURIComponent('also bad!'),
      )
      render()

      const call = prefillCalls()[0]
      expect(call[1]).not.toHaveProperty('itc')
      expect(call[1]).not.toHaveProperty('itcSource')
    })
  })

  describe('firstprompt.prefill dedupe', () => {
    function prefillCount() {
      return mockLogAnalytics.mock.calls.filter(c => c[0] === 'homepage.firstprompt.prefill').length
    }

    it('fires exactly once under a StrictMode double-invoke', () => {
      // Exercises hasPrefilledRef's suppression via React's dev-mode StrictMode
      // double-invoke (mount→cleanup→mount, promptText still '' so the
      // `if (promptText) return` guard cannot help). Only happens when __DEV__
      // (NODE_ENV !== 'production'), which holds under Vitest.
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=logo')
      renderHook(
        () => useDeeplinkPromptPrefill({ promptText: '', onPrefill: mockOnPrefill, logAnalytics: mockLogAnalytics }),
        { wrapper: StrictMode },
      )
      expect(prefillCount()).toBe(1)
    })

    it('still prefills once when intl.messages hydrate after the first render', () => {
      // First render: empty messages → key not found → no event, ref stays false.
      mockIntlMessages.value = {}
      mockSearchParams.value = new URLSearchParams('initialPromptKey=logo')
      const { rerender } = render()
      expect(prefillCount()).toBe(0)

      // Messages hydrate (new object reference re-runs the effect); promptText is still ''.
      mockIntlMessages.value = { builder_deeplink_prompt_logo: 'Create a logo' }
      rerender()
      expect(prefillCount()).toBe(1)
    })

    it('does NOT warn not_found while messages are still empty, but does once loaded without the key', () => {
      const warnedNotFound = () =>
        vi.mocked(logger.warn).mock.calls.some(
          ([event, data]: [string, { reason?: string }]) =>
            event === 'homepage.prompt.prefill_key_unknown' && data?.reason === 'not_found',
        )

      // First render: messages not loaded yet (empty map). A valid key that
      // simply hasn't hydrated must NOT emit the "key not created in i18n" signal.
      mockIntlMessages.value = {}
      mockSearchParams.value = new URLSearchParams('initialPromptKey=logo')
      const { rerender } = render()
      expect(warnedNotFound()).toBe(false)

      // Messages load WITHOUT the requested key → now it's genuinely not_found.
      mockIntlMessages.value = { builder_deeplink_prompt_other: 'Something else' }
      rerender()
      expect(warnedNotFound()).toBe(true)
    })
  })

  describe('CTA enable contract (Component 2 regression pin)', () => {
    it('key prefill calls onPrefill with non-empty text (the value the CTA enable check reads)', () => {
      mockIntlMessages.value = { builder_deeplink_prompt_jewelry: 'Create a jewelry store' }
      mockSearchParams.value = new URLSearchParams('initialPromptKey=jewelry')
      render()

      expect(typeof lastSetText()).toBe('string')
      expect((lastSetText() as string).trim().length).toBeGreaterThan(0)
    })
  })
})
