import { describe, it, expect, vi } from 'vitest'
import {
  recordTokenUsageObservability,
  type TokenUsageObservabilityLogger,
  type TokenUsageApmTracker,
} from '../token-usage-observability.js'

type MockLogger = TokenUsageObservabilityLogger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

function makeLogger(): MockLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makeApm(): TokenUsageApmTracker & { trackTokenUsageInAPM: ReturnType<typeof vi.fn> } {
  return { trackTokenUsageInAPM: vi.fn() }
}

/** Find the data payload of the info log with the given event name. */
function infoData(logger: MockLogger, event: string): Record<string, unknown> | undefined {
  const call = logger.info.mock.calls.find((c) => c[0] === event)
  return call?.[1] as Record<string, unknown> | undefined
}

const baseUsage = {
  inputTokens: 10000,
  outputTokens: 500,
  totalTokens: 10500,
  cachedInputTokensRead: 7000,
}

const baseMetadata = {
  appId: 'app123',
  agentName: 'DevelopAgent',
  modelName: 'claude-sonnet-4-5',
  conversationId: 'conv-1',
}

describe('recordTokenUsageObservability', () => {
  it('emits granular token.usage / token.cache / token.cost logs', () => {
    const logger = makeLogger()
    recordTokenUsageObservability({
      usage: baseUsage,
      metadata: baseMetadata,
      apmTracker: makeApm(),
      logger,
      eventPrefix: 'sse.token_usage',
    })

    expect(infoData(logger, 'token.usage')).toMatchObject({
      inputTokens: 10000,
      outputTokens: 500,
      totalTokens: 10500,
    })
    expect(infoData(logger, 'token.cache')).toMatchObject({ totalCachedTokens: 7000, read: 7000 })
    expect(infoData(logger, 'token.cost')).toHaveProperty('details')
  })

  it('emits token.cache.none when there are no cached tokens', () => {
    const logger = makeLogger()
    recordTokenUsageObservability({
      usage: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200 },
      metadata: baseMetadata,
      apmTracker: makeApm(),
      logger,
      eventPrefix: 'sse.token_usage',
    })
    expect(logger.info.mock.calls.some((c) => c[0] === 'token.cache.none')).toBe(true)
    expect(logger.info.mock.calls.some((c) => c[0] === 'token.cache')).toBe(false)
  })

  it('tracks APM, emits the tracked log with cost + cache metrics, and returns totalCost', () => {
    const logger = makeLogger()
    const apmTracker = makeApm()

    const result = recordTokenUsageObservability({
      usage: baseUsage,
      metadata: baseMetadata,
      apmTracker,
      logger,
      eventPrefix: 'sse.token_usage',
    })

    expect(apmTracker.trackTokenUsageInAPM).toHaveBeenCalledWith(
      'main_agent',
      expect.objectContaining({
        inputTokens: 10000,
        outputTokens: 500,
        totalTokens: 10500,
        cacheReadTokens: 7000,
        cacheWriteTokens: 0,
      }),
      expect.objectContaining({
        conversationId: 'conv-1',
        appId: 'app123',
        agentName: 'DevelopAgent',
        modelName: 'claude-sonnet-4-5',
      }),
    )

    const data = infoData(logger, 'sse.token_usage.tracked')
    expect(data).toMatchObject({
      appId: 'app123',
      cachedInputTokens: 7000,
      freshInputTokens: 3000,
      cacheHitRate: 70,
      hasConversation: true,
    })
    expect(typeof data?.cost).toBe('number')
    expect(result.totalCost).toBe(data?.cost)
  })

  it('uses the supplied eventPrefix so WS keeps its historical event name', () => {
    const logger = makeLogger()
    recordTokenUsageObservability({
      usage: baseUsage,
      metadata: baseMetadata,
      apmTracker: makeApm(),
      logger,
      eventPrefix: 'websocket.token_usage',
    })
    expect(logger.info.mock.calls.some((c) => c[0] === 'websocket.token_usage.tracked')).toBe(true)
  })

  it('without appId: still emits granular logs + returns cost, but skips APM and the tracked log', () => {
    const logger = makeLogger()
    const apmTracker = makeApm()

    const result = recordTokenUsageObservability({
      usage: baseUsage,
      metadata: { ...baseMetadata, appId: undefined },
      apmTracker,
      logger,
      eventPrefix: 'sse.token_usage',
    })

    // Granular logs (no appId required) still fire.
    expect(infoData(logger, 'token.usage')).toBeDefined()
    expect(infoData(logger, 'token.cost')).toBeDefined()
    // appId-scoped observability is skipped.
    expect(logger.warn).toHaveBeenCalledWith('sse.token_usage.no_app_id', expect.any(Object))
    expect(apmTracker.trackTokenUsageInAPM).not.toHaveBeenCalled()
    expect(infoData(logger, 'sse.token_usage.tracked')).toBeUndefined()
    // Cost is still computed and returned for the span (matches WS behavior).
    expect(typeof result.totalCost).toBe('number')
  })

  it('never throws when APM fails, logs tracking_failed (with modelName), and still returns the computed cost', () => {
    const logger = makeLogger()
    const apmTracker: TokenUsageApmTracker = {
      trackTokenUsageInAPM: vi.fn(() => {
        throw new Error('apm boom')
      }),
    }

    const result = recordTokenUsageObservability({
      usage: baseUsage,
      metadata: baseMetadata,
      apmTracker,
      logger,
      eventPrefix: 'sse.token_usage',
    })

    expect(logger.error).toHaveBeenCalledWith(
      'sse.token_usage.tracking_failed',
      expect.objectContaining({ error: 'apm boom', appId: 'app123', modelName: 'claude-sonnet-4-5' }),
    )
    // A side-effecting APM failure must NOT discard the already-computed cost
    // (regression guard: the span still needs it).
    expect(typeof result.totalCost).toBe('number')
    // Granular logs ran before the APM failure.
    expect(infoData(logger, 'token.usage')).toBeDefined()
  })

  it('reports cacheHitRate 0 and fresh = input in the tracked log when no cache tokens', () => {
    const logger = makeLogger()
    recordTokenUsageObservability({
      usage: { inputTokens: 4000, outputTokens: 200, totalTokens: 4200 },
      metadata: baseMetadata,
      apmTracker: makeApm(),
      logger,
      eventPrefix: 'sse.token_usage',
    })
    expect(infoData(logger, 'sse.token_usage.tracked')).toMatchObject({
      cachedInputTokens: 0,
      freshInputTokens: 4000,
      cacheHitRate: 0,
    })
  })
})
