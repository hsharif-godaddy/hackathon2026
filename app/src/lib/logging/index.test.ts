/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetInstrumentationAppId,
  mockNormalizedAppId,
  mockGetSharedInstrumentationContext,
  mockLoggerWarn,
  mockClientLogBufferAdd,
  mockClientLogBufferGetSessionId,
} = vi.hoisted(() => ({
  mockGetInstrumentationAppId: vi.fn<() => string | undefined>(),
  mockNormalizedAppId: vi.fn<(v: string | null | undefined) => string | undefined>(),
  mockGetSharedInstrumentationContext: vi.fn<(callerIntentCategory?: unknown) => Record<string, string>>(),
  mockLoggerWarn: vi.fn(),
  mockClientLogBufferAdd: vi.fn(),
  mockClientLogBufferGetSessionId: vi.fn<() => string | undefined>(),
}))

vi.mock('@/utils/instrumentation', () => ({
  getInstrumentationAppId: mockGetInstrumentationAppId,
  normalizedAppId: mockNormalizedAppId,
  getSharedInstrumentationContext: mockGetSharedInstrumentationContext,
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: mockLoggerWarn,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('./client-log-buffer', () => ({
  ClientLogBuffer: {
    add: mockClientLogBufferAdd,
    getSessionId: mockClientLogBufferGetSessionId,
  },
}))

import { mergeAnalyticsContext, shipAnalyticsLog } from './index'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetInstrumentationAppId.mockReturnValue(undefined)
  mockNormalizedAppId.mockImplementation((v) => (v == null || v === '' ? undefined : v))
  mockGetSharedInstrumentationContext.mockReturnValue({})
  mockClientLogBufferGetSessionId.mockReturnValue(undefined)
})

describe('mergeAnalyticsContext', () => {
  describe('appId precedence', () => {
    it('uses module appId when present and no caller appId', () => {
      mockGetInstrumentationAppId.mockReturnValue('module-app-1')

      const result = mergeAnalyticsContext({})

      expect(result.appId).toBe('module-app-1')
    })

    it('uses caller appId (normalized) when module appId is absent', () => {
      mockGetInstrumentationAppId.mockReturnValue(undefined)
      mockNormalizedAppId.mockReturnValue('caller-app-1')

      const result = mergeAnalyticsContext({ appId: 'caller-app-1' })

      expect(result.appId).toBe('caller-app-1')
    })

    it('module appId wins when both are present and differ', () => {
      mockGetInstrumentationAppId.mockReturnValue('module-app-1')
      mockNormalizedAppId.mockReturnValue('caller-app-2')

      const result = mergeAnalyticsContext({ appId: 'caller-app-2' })

      expect(result.appId).toBe('module-app-1')
    })

    it('emits conflict warning when module and caller appIds differ', () => {
      mockGetInstrumentationAppId.mockReturnValue('module-app-1')
      mockNormalizedAppId.mockReturnValue('caller-app-2')

      mergeAnalyticsContext({ appId: 'caller-app-2' })

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'logging.mergeAnalyticsContext.appId.conflict',
        expect.objectContaining({
          callerAppId: 'caller-app-2',
          currentAppId: 'module-app-1',
        }),
      )
    })

    it('does not warn when module and caller appIds match', () => {
      mockGetInstrumentationAppId.mockReturnValue('app-1')
      mockNormalizedAppId.mockReturnValue('app-1')

      mergeAnalyticsContext({ appId: 'app-1' })

      expect(mockLoggerWarn).not.toHaveBeenCalled()
    })

    it('drops UUID-shaped caller appId (normalizedAppId returns undefined)', () => {
      mockGetInstrumentationAppId.mockReturnValue(undefined)
      // Simulates normalizedAppId rejecting a UUID-shaped value
      mockNormalizedAppId.mockReturnValue(undefined)

      const result = mergeAnalyticsContext({ appId: '550e8400-e29b-41d4-a716-446655440000' })

      expect(result.appId).toBeUndefined()
    })

    it('omits appId entirely when both module and caller resolve to absent', () => {
      mockGetInstrumentationAppId.mockReturnValue(undefined)
      mockNormalizedAppId.mockReturnValue(undefined)

      const result = mergeAnalyticsContext({})

      expect('appId' in result).toBe(false)
    })
  })

  describe('context fields', () => {
    it('merges entry_point when set', () => {
      mockGetSharedInstrumentationContext.mockReturnValue({ entry_point: 'organic' })

      const result = mergeAnalyticsContext({})

      expect(result.entry_point).toBe('organic')
    })

    it('merges plan_type when set', () => {
      mockGetSharedInstrumentationContext.mockReturnValue({ plan_type: 'premium' })

      const result = mergeAnalyticsContext({})

      expect(result.plan_type).toBe('premium')
    })

    it('merges creation_source when set', () => {
      mockGetSharedInstrumentationContext.mockReturnValue({ creation_source: 'landing_page' })

      const result = mergeAnalyticsContext({})

      expect(result.creation_source).toBe('landing_page')
    })

    it('merges business_name when set', () => {
      mockGetSharedInstrumentationContext.mockReturnValue({ business_name: 'Acme Corp' })

      const result = mergeAnalyticsContext({})

      expect(result.business_name).toBe('Acme Corp')
    })

    it('omits context fields that are undefined', () => {
      mockGetSharedInstrumentationContext.mockReturnValue({})

      const result = mergeAnalyticsContext({})

      expect('entry_point' in result).toBe(false)
      expect('plan_type' in result).toBe(false)
      expect('creation_source' in result).toBe(false)
    })

    it('passes through caller-supplied fields not in the context set', () => {
      const result = mergeAnalyticsContext({ domain: 'example.com', source: 'paywall' })

      expect(result.domain).toBe('example.com')
      expect(result.source).toBe('paywall')
    })
  })

  describe('intent_category caller-wins precedence', () => {
    it('uses caller intent_category over session-level baseline', () => {
      // getSharedInstrumentationContext receives callerIntentCategory='edit' and omits
      // intent_category from context — the caller's value passes through via rest spread
      mockGetSharedInstrumentationContext.mockReturnValue({})

      const result = mergeAnalyticsContext({ intent_category: 'edit' })

      expect(result.intent_category).toBe('edit')
    })

    it('falls back to session-level intent_category when caller does not provide one', () => {
      mockGetSharedInstrumentationContext.mockReturnValue({ intent_category: 'new_build' })

      const result = mergeAnalyticsContext({})

      expect(result.intent_category).toBe('new_build')
    })

    it('omits intent_category when neither caller nor session provides one', () => {
      mockGetSharedInstrumentationContext.mockReturnValue({})

      const result = mergeAnalyticsContext({})

      expect('intent_category' in result).toBe(false)
    })
  })
})

describe('shipAnalyticsLog', () => {
  it('calls ClientLogBuffer.add with merged context and source: analytics', () => {
    mockGetInstrumentationAppId.mockReturnValue('app-1')

    shipAnalyticsLog('airoplus.purchase.in-app', { domain: 'example.com' })

    expect(mockClientLogBufferAdd).toHaveBeenCalledTimes(1)
    expect(mockClientLogBufferAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        event: 'airoplus.purchase.in-app',
        data: expect.objectContaining({
          appId: 'app-1',
          domain: 'example.com',
          source: 'analytics',
        }),
      }),
    )
  })

  it('source: analytics is always present regardless of caller data', () => {
    shipAnalyticsLog('some.event', { source: 'other' })

    expect(mockClientLogBufferAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'analytics' }),
      }),
    )
  })

  it('returns early without calling ClientLogBuffer when window is undefined', () => {
    vi.stubGlobal('window', undefined)
    try {
      shipAnalyticsLog('some.event', {})
      expect(mockClientLogBufferAdd).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
