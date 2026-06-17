/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/logging', () => ({ shipAnalyticsLog: vi.fn() }))

import { shipAnalyticsLog } from '@/lib/logging'
import { logger } from '@/lib/request-context'
import {
  CONNECT_DURATION_WARN_MS,
  ERROR_BUCKET_WARN_THRESHOLD,
  FIRST_RESPONSE_WARN_MS,
  SSEQualityMonitor,
} from '../SSEQualityMonitor'

const mockShip = shipAnalyticsLog as unknown as ReturnType<typeof vi.fn>
const mockWarn = logger.warn as unknown as ReturnType<typeof vi.fn>

describe('SSEQualityMonitor', () => {
  let monitor: SSEQualityMonitor

  beforeEach(() => {
    vi.useFakeTimers()
    monitor = new SSEQualityMonitor()
    vi.clearAllMocks()
  })

  afterEach(() => {
    monitor.destroy()
    vi.useRealTimers()
  })

  it('emits funnel.sse.connected once per connect with phases, streamOpenMs and totalMs', () => {
    monitor.markConnectStart('app123456')
    monitor.recordConnectPhases({
      configFetchMs: 40,
      tokenFetchMs: 60,
      conversationCreateMs: 120,
      conversationSource: 'created',
    })
    monitor.markStreamOpenStart()
    vi.advanceTimersByTime(200)
    monitor.markFirstStreamEvent()

    expect(mockShip).toHaveBeenCalledTimes(1)
    const [event, data] = mockShip.mock.calls[0]
    expect(event).toBe('funnel.sse.connected')
    expect(data).toMatchObject({
      appId: 'app123456',
      configFetchMs: 40,
      tokenFetchMs: 60,
      conversationCreateMs: 120,
      conversationSource: 'created',
    })
    expect(typeof data.streamOpenMs).toBe('number')
    expect(typeof data.totalMs).toBe('number')

    // A later stream event (reconnect re-timing) does NOT re-emit the funnel.
    monitor.markStreamOpenStart()
    vi.advanceTimersByTime(10)
    monitor.markFirstStreamEvent()
    expect(mockShip).toHaveBeenCalledTimes(1)
  })

  it('warns slow_connect when totalMs exceeds threshold', () => {
    monitor.markConnectStart('app123456')
    monitor.recordConnectPhases({ configFetchMs: 10, tokenFetchMs: 10, conversationSource: 'cookie' })
    monitor.markStreamOpenStart()
    vi.advanceTimersByTime(CONNECT_DURATION_WARN_MS + 1)
    monitor.markFirstStreamEvent()

    expect(mockWarn).toHaveBeenCalledWith(
      'sse.transport.quality.slow_connect',
      expect.objectContaining({ appId: 'app123456', threshold: CONNECT_DURATION_WARN_MS }),
    )
  })

  it('omits conversationCreateMs when conversation came from cookie', () => {
    monitor.markConnectStart('app123456')
    monitor.recordConnectPhases({ configFetchMs: 10, tokenFetchMs: 10, conversationSource: 'cookie' })
    monitor.markStreamOpenStart()
    vi.advanceTimersByTime(50)
    monitor.markFirstStreamEvent()

    const [, data] = mockShip.mock.calls[0]
    expect(data.conversationSource).toBe('cookie')
    expect(data).not.toHaveProperty('conversationCreateMs')
  })

  it('emits funnel.sse.first_response once per send and warns when slow', () => {
    monitor.markConnectStart('app123456')
    monitor.markSend()
    vi.advanceTimersByTime(FIRST_RESPONSE_WARN_MS + 1)
    monitor.markFirstResponse()

    expect(mockShip).toHaveBeenCalledWith(
      'funnel.sse.first_response',
      expect.objectContaining({ appId: 'app123456' }),
    )
    expect(mockWarn).toHaveBeenCalledWith(
      'sse.transport.quality.slow_first_response',
      expect.objectContaining({ threshold: FIRST_RESPONSE_WARN_MS }),
    )

    // Second first-response with no pending send is ignored.
    mockShip.mockClear()
    monitor.markFirstResponse()
    expect(mockShip).not.toHaveBeenCalled()
  })

  it('ignores markFirstResponse when there is no pending send', () => {
    monitor.markFirstResponse()
    expect(mockShip).not.toHaveBeenCalled()
  })

  it('clearSend prevents a stale first-response from emitting', () => {
    monitor.markSend()
    monitor.clearSend()
    monitor.markFirstResponse()
    expect(mockShip).not.toHaveBeenCalled()
  })

  it('warns excessive_errors only at bucket crossings (3/6/9) and resets', () => {
    for (let i = 1; i <= 9; i++) monitor.recordEventSourceError(i)
    const warnEvents = mockWarn.mock.calls.filter(([e]) => e === 'sse.transport.quality.excessive_errors')
    expect(warnEvents).toHaveLength(3)
    expect(warnEvents.map(([, d]) => d.consecutiveErrors)).toEqual([
      ERROR_BUCKET_WARN_THRESHOLD,
      ERROR_BUCKET_WARN_THRESHOLD * 2,
      ERROR_BUCKET_WARN_THRESHOLD * 3,
    ])

    mockWarn.mockClear()
    monitor.resetErrorBuckets()
    monitor.recordEventSourceError(1)
    monitor.recordEventSourceError(2)
    monitor.recordEventSourceError(3)
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('invalidates an in-flight connect when the tab is backgrounded', () => {
    monitor.markConnectStart('app123456')
    monitor.recordConnectPhases({ configFetchMs: 10, tokenFetchMs: 10, conversationSource: 'cookie' })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    monitor.markStreamOpenStart()
    monitor.markFirstStreamEvent()
    expect(mockShip).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('does not start connect timing when the tab is already hidden', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    monitor.markConnectStart('app123456')
    monitor.recordConnectPhases({ configFetchMs: 10, tokenFetchMs: 10, conversationSource: 'cookie' })
    monitor.markStreamOpenStart()
    monitor.markFirstStreamEvent()
    expect(mockShip).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('invalidates a pending send when the tab is backgrounded', () => {
    monitor.markConnectStart('app123456')
    monitor.markSend()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    monitor.markFirstResponse()
    expect(mockShip).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  describe('resource timing', () => {
    const STREAM_URL = 'https://agent.example/api/conversations/app/conv/stream'

    let perfSpy: ReturnType<typeof vi.spyOn> | null = null

    function stubEntries(entries: Array<Partial<PerformanceResourceTiming>>): void {
      perfSpy = vi.spyOn(performance, 'getEntriesByType').mockReturnValue(entries as unknown as PerformanceEntryList)
    }

    afterEach(() => {
      perfSpy?.mockRestore()
      perfSpy = null
    })

    function emitConnect(streamUrl?: string): Record<string, unknown> {
      monitor.markConnectStart('app123456')
      monitor.recordConnectPhases({ configFetchMs: 10, tokenFetchMs: 10, conversationSource: 'cookie' })
      monitor.markStreamOpenStart(streamUrl)
      vi.advanceTimersByTime(50)
      monitor.markFirstStreamEvent()
      return mockShip.mock.calls.at(-1)![1]
    }

    it('attaches token and stream resource timing (TLS path) when matching entries exist', () => {
      stubEntries([
        {
          name: 'https://app.example/api/auth/agent-token',
          startTime: 90, requestStart: 100, responseStart: 130, responseEnd: 150,
          connectStart: 10, connectEnd: 10,
        },
        {
          name: STREAM_URL,
          domainLookupStart: 5, domainLookupEnd: 12,
          connectStart: 12, secureConnectionStart: 20, connectEnd: 30,
          requestStart: 30, responseStart: 45,
        },
      ])

      const data = emitConnect(STREAM_URL)

      expect(data.tokenResourceTiming).toEqual({
        serverProcessingMs: 30, transferMs: 20, totalFetchMs: 60, connectionReused: true,
      })
      expect(data.streamResourceTiming).toEqual({ dnsMs: 7, tcpMs: 8, tlsMs: 10, ttfbMs: 15 })
    })

    it('computes stream timing on the no-TLS path (secureConnectionStart === 0)', () => {
      stubEntries([
        {
          name: STREAM_URL,
          domainLookupStart: 5, domainLookupEnd: 5,
          connectStart: 10, secureConnectionStart: 0, connectEnd: 18,
          requestStart: 18, responseStart: 28,
        },
      ])

      const data = emitConnect(STREAM_URL)

      expect(data.streamResourceTiming).toEqual({ dnsMs: 0, tcpMs: 8, tlsMs: 0, ttfbMs: 10 })
    })

    it('omits resource timing when no token entry matches and streamUrl is absent', () => {
      stubEntries([{ name: 'https://app.example/api/other', requestStart: 0, responseStart: 0, responseEnd: 0, startTime: 0, connectStart: 0, connectEnd: 0 }])

      const data = emitConnect()

      expect(data).not.toHaveProperty('tokenResourceTiming')
      expect(data).not.toHaveProperty('streamResourceTiming')
    })

    it('omits stream resource timing when streamUrl is malformed (URL parse throws)', () => {
      stubEntries([{ name: STREAM_URL, domainLookupStart: 0, domainLookupEnd: 0, connectStart: 0, secureConnectionStart: 0, connectEnd: 0, requestStart: 0, responseStart: 0 }])

      const data = emitConnect('::::not-a-url')

      expect(data).not.toHaveProperty('streamResourceTiming')
    })

    it('does not leak a prior connect stream URL into a later connect with no stream URL', () => {
      stubEntries([
        {
          name: STREAM_URL,
          domainLookupStart: 5, domainLookupEnd: 12,
          connectStart: 12, secureConnectionStart: 20, connectEnd: 30,
          requestStart: 30, responseStart: 45,
        },
      ])

      const first = emitConnect(STREAM_URL)
      expect(first).toHaveProperty('streamResourceTiming')

      const second = emitConnect()
      expect(second).not.toHaveProperty('streamResourceTiming')
    })
  })
})
