import { context as otelContext } from '@opentelemetry/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildChatSignalsTraceContext } from '../signals-trace-context.js'

vi.mock('@signals/sdk', () => ({
  getSignalsContext: vi.fn(),
}))

vi.mock('@signals/otel-sdk', () => ({
  createTraceContext: vi.fn(),
}))

import { createTraceContext } from '@signals/otel-sdk'
import { getSignalsContext } from '@signals/sdk'

describe('buildChatSignalsTraceContext', function suite() {
  const logger = { warn: vi.fn() }

  beforeEach(function reset() {
    vi.clearAllMocks()
    logger.warn.mockReset()
    vi.mocked(getSignalsContext).mockReturnValue({})
    vi.mocked(createTraceContext).mockImplementation(function () { return otelContext.active(); })
  })

  it('merges JWT customerId visitorId and maps trafficSessionId to sessionId', function jwtMerge() {
    buildChatSignalsTraceContext({
      headers: { cookie: 'pathway=x' },
      jwtAgentContext: {
        customerId: 'c1',
        visitorId: 'v1',
        trafficSessionId: 'ts1',
      },
      appId: 'app-1',
      logPrefix: 'sse',
      logger,
    })

    expect(createTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        signalsContext: expect.objectContaining({
          customerId: 'c1',
          visitorId: 'v1',
          sessionId: 'ts1',
        }),
      }),
    )
  })

  it('drops empty-string JWT fields', function emptyJwt() {
    buildChatSignalsTraceContext({
      jwtAgentContext: {
        customerId: '',
        visitorId: '',
        trafficSessionId: '',
      },
      logPrefix: 'websocket',
      logger,
    })

    const arg = vi.mocked(createTraceContext).mock.calls[0][0] as { signalsContext: Record<string, unknown> }
    expect(arg.signalsContext.customerId).toBeUndefined()
    expect(arg.signalsContext.visitorId).toBeUndefined()
    expect(arg.signalsContext.sessionId).toBeUndefined()
  })

  it('falls back to active context when getSignalsContext throws', function getCtxFail() {
    vi.mocked(getSignalsContext).mockImplementation(function () {
      throw new Error('signals boom')
    })

    buildChatSignalsTraceContext({
      logPrefix: 'sse',
      logger,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      'sse.signals.get_context_failed',
      expect.objectContaining({
        error: 'signals boom',
        errorStack: expect.stringContaining('signals boom'),
      }),
    )
    expect(createTraceContext).toHaveBeenCalled()
  })

  it('falls back to otelContext.active when createTraceContext throws', function createCtxFail() {
    vi.mocked(createTraceContext).mockImplementation(function () {
      throw new Error('trace boom')
    })

    const ctx = buildChatSignalsTraceContext({
      logPrefix: 'websocket',
      logFields: { socketId: 's1' },
      logger,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      'websocket.signals.create_trace_context_failed',
      expect.objectContaining({
        error: 'trace boom',
        errorStack: expect.stringContaining('trace boom'),
      }),
    )
    expect(ctx).toBe(otelContext.active())
  })

  it('includes screenshot URLs in businessContext when GODADDY_API_BASE_URL is set', function screenshots() {
    vi.stubEnv('GODADDY_API_BASE_URL', 'https://api.test-godaddy.com')

    buildChatSignalsTraceContext({
      appId: 'my-app',
      logPrefix: 'sse',
      logger,
    })

    expect(createTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        businessContext: expect.objectContaining({
          data: expect.objectContaining({
            appId: 'my-app',
            defaultScreenshotUrl: expect.stringContaining('my-app'),
            listPublishedSnapshotsUrl: expect.stringContaining('my-app'),
          }),
        }),
      }),
    )

    vi.unstubAllEnvs()
  })

  it('omits screenshot keys when GODADDY_API_BASE_URL is unset', function noApiUrl() {
    vi.stubEnv('GODADDY_API_BASE_URL', '')

    buildChatSignalsTraceContext({
      appId: 'my-app',
      logPrefix: 'sse',
      logger,
    })

    const arg = vi.mocked(createTraceContext).mock.calls[0][0] as {
      businessContext: { data: Record<string, unknown> }
    }
    expect(arg.businessContext.data.appId).toBe('my-app')
    expect(arg.businessContext.data.defaultScreenshotUrl).toBeUndefined()

    vi.unstubAllEnvs()
  })

  it('includes fullStorySessionId in signalsContext when provided', function fullStory() {
    buildChatSignalsTraceContext({
      appId: 'my-app',
      fullStorySessionId: '123:456',
      logPrefix: 'sse',
      logger,
    })

    expect(createTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        signalsContext: expect.objectContaining({
          fullStorySessionId: '123:456',
        }),
      }),
    )
  })

  it('omits fullStorySessionId from signalsContext when absent or empty', function noFullStory() {
    buildChatSignalsTraceContext({
      appId: 'my-app',
      fullStorySessionId: '',
      logPrefix: 'sse',
      logger,
    })

    const arg = vi.mocked(createTraceContext).mock.calls[0][0] as {
      signalsContext: Record<string, unknown>
    }
    expect(arg.signalsContext.fullStorySessionId).toBeUndefined()
  })

  it('attaches fullStorySessionId to signalsContext even when appId is absent', function fullStoryNoApp() {
    buildChatSignalsTraceContext({
      fullStorySessionId: '789',
      logPrefix: 'sse',
      logger,
    })

    expect(createTraceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        signalsContext: expect.objectContaining({
          fullStorySessionId: '789',
        }),
      }),
    )
  })
})
