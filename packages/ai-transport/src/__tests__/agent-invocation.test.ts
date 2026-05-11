import { describe, it, expect, vi, beforeEach } from 'vitest'
import { context as otelContext } from '@opentelemetry/api'

const spanEndCalls: unknown[] = []

vi.mock('@godaddy/agent-otel-sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@godaddy/agent-otel-sdk')
  return {
    ...actual,
    emitError: vi.fn(),
    createAgentContext: vi.fn(() => otelContext.active()),
    createAgentInvocationSpan: vi.fn(() => ({
      context: otelContext.active(),
      end: vi.fn((input: unknown) => {
        spanEndCalls.push(input)
      }),
    })),
  }
})
vi.mock('@godaddy/agent-observability-events', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@godaddy/agent-observability-events')
  return {
    ...actual,
    createError: vi.fn((input: unknown) => ({ kind: 'error', input })),
  }
})

import { emitError, createAgentInvocationSpan } from '@godaddy/agent-otel-sdk'
import { createError } from '@godaddy/agent-observability-events'
import { formatAgentId, emitTurnError, createAgentInvocation } from '../agent-invocation.js'

describe('formatAgentId', () => {
  it('prepends the airo-app-builder prefix', () => {
    expect(formatAgentId('develop')).toBe('airo-app-builder-develop')
  })
})

describe('emitTurnError', () => {
  const warn = vi.fn()
  const logger = { warn }

  beforeEach(() => {
    vi.mocked(emitError).mockReset()
    vi.mocked(createError).mockReset().mockImplementation((input: unknown) => ({ kind: 'error', input }) as any)
    warn.mockReset()
  })

  it('builds the event with provided classification and forwards to emitError', () => {
    const err = new Error('kaboom')
    emitTurnError({
      conversationId: 'conv_1',
      agentId: 'airo-app-builder-develop',
      error: err,
      errorType: 'RETRY_ERROR',
      isRetryable: true,
      logger,
    })

    expect(vi.mocked(createError)).toHaveBeenCalledWith(expect.objectContaining({
      errorType: 'RETRY_ERROR',
      errorMessage: 'kaboom',
      errorPhase: 'execution',
      isRetryable: true,
      errorStack: err.stack,
    }))
    expect(vi.mocked(emitError)).toHaveBeenCalledWith({
      conversationId: 'conv_1',
      agentId: 'airo-app-builder-develop',
      eventData: { kind: 'error', input: expect.any(Object) },
    })
  })

  it('defaults errorType to error.name (not constructor.name) so subclass overrides win', () => {
    // Class name and `name` property diverge so we can tell which is read.
    // Minifiers can rewrite constructor.name to a mangled single char, but
    // override name = '...' survives. This test pins the stable source.
    class DbErrorImpl extends Error { override name = 'db.connection' }
    emitTurnError({
      conversationId: 'conv_1',
      agentId: 'a',
      error: new DbErrorImpl('bad'),
      logger,
    })
    expect(vi.mocked(createError)).toHaveBeenCalledWith(expect.objectContaining({
      errorType: 'db.connection',
      errorPhase: 'execution',
      isRetryable: false,
    }))
  })

  it('coerces non-Error throws with String() and defaults errorType to "Error"', () => {
    emitTurnError({
      conversationId: 'conv_1',
      agentId: 'a',
      error: 'bare string thrown',
      logger,
    })
    expect(vi.mocked(createError)).toHaveBeenCalledWith(expect.objectContaining({
      errorType: 'Error',
      errorMessage: 'bare string thrown',
    }))
    // No stack frame should be emitted for non-Error values.
    expect(vi.mocked(createError).mock.calls[0]![0]).not.toHaveProperty('errorStack')
  })

  it('omits errorStack (rather than emitting undefined) when Error has a falsy stack', () => {
    const err = new Error('no stack here')
    Object.defineProperty(err, 'stack', { value: '', configurable: true })
    emitTurnError({
      conversationId: 'conv_1', agentId: 'a', error: err, logger,
    })
    expect(vi.mocked(createError).mock.calls[0]![0]).not.toHaveProperty('errorStack')
  })

  it('swallows telemetry failures and logs a warning with telemetryError field populated', () => {
    vi.mocked(emitError).mockImplementation(() => { throw new Error('telemetry down') })
    expect(() => emitTurnError({
      conversationId: 'c', agentId: 'a', error: new Error('x'), logger,
    })).not.toThrow()
    // Pin the telemetryError payload so a typo in the field name is caught.
    expect(warn).toHaveBeenCalledWith('turn.error.telemetry_emit_failed', {
      conversationId: 'c',
      agentId: 'a',
      telemetryError: 'telemetry down',
    })
  })

  it('does not throw even when the logger itself throws (Never-throws contract), and console.error carries telemetryError', () => {
    vi.mocked(emitError).mockImplementation(() => { throw new Error('telemetry down') })
    const throwingLogger = { warn: vi.fn(() => { throw new Error('logger broken') }) }
    // Silence the console.error fallback so test output stays clean; we
    // only care that the overall call does not throw and that the triage
    // context (telemetryError) is preserved.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => emitTurnError({
        conversationId: 'c', agentId: 'a', error: new Error('x'), logger: throwingLogger,
      })).not.toThrow()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'turn.error.telemetry_emit_failed',
        { conversationId: 'c', agentId: 'a', telemetryError: 'telemetry down' },
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

describe('createAgentInvocation', () => {
  const logger = { warn: vi.fn() }

  beforeEach(() => {
    spanEndCalls.length = 0
    logger.warn.mockReset()
    vi.mocked(createAgentInvocationSpan).mockClear()
  })

  it('exposes a context and calls endSuccess exactly once with provided fields', () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
      agentName: 'develop',
      prompt: 'hi',
      conversationId: 'conv_1',
      logger,
    })
    expect(inv.ended).toBe(false)
    inv.endSuccess({ outputText: 'ok', responseType: 'llm_reply', finishReason: 'complete' })
    expect(inv.ended).toBe(true)
    expect(spanEndCalls).toHaveLength(1)
    expect(spanEndCalls[0]).toMatchObject({
      outputText: 'ok',
      responseType: 'llm_reply',
      finishReason: 'complete',
      success: true,
    })
  })

  it('endAborted records success:false with finishReason="aborted"', () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
      agentName: 'develop',
      prompt: 'hi',
      conversationId: 'conv_1',
      logger,
    })
    inv.endAborted({ outputText: '', responseType: 'tool_call' })
    expect(spanEndCalls[0]).toMatchObject({ success: false, finishReason: 'aborted' })
  })

  it('endError records success:false and preserves provided finishReason', () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
      agentName: 'develop',
      prompt: 'hi',
      conversationId: 'conv_1',
      logger,
    })
    inv.endError(new Error('x'), { finishReason: 'budget_retry' })
    expect(spanEndCalls[0]).toMatchObject({ success: false, finishReason: 'budget_retry' })
  })

  it('ignores repeated end() calls (idempotent)', () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
      agentName: 'develop',
      prompt: 'hi',
      conversationId: 'conv_1',
      logger,
    })
    inv.endSuccess({ outputText: 'a', responseType: 'llm_reply' })
    inv.endError(new Error('late'))
    expect(spanEndCalls).toHaveLength(1)
  })

  it('inferProvider defaults to anthropic for claude model names', () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
      agentName: 'develop',
      prompt: 'hi',
      conversationId: 'conv_1',
      logger,
    })
    inv.endSuccess({ outputText: '', responseType: 'tool_call' })
    expect(vi.mocked(createAgentInvocationSpan)).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }))
  })

  // end*() are called from outer catch blocks in both transports. A throw
  // from the OTEL SDK there would replace the original error or silently
  // fail a happy path. These tests pin the safeEnd fallback: warn first,
  // console.error if the logger itself throws, never bubble.
  describe('safeEnd fallback (logger guard around invocation.end)', () => {
    function mockThrowingSpan(): void {
      vi.mocked(createAgentInvocationSpan).mockImplementationOnce(() => ({
        context: otelContext.active(),
        end: vi.fn(() => { throw new Error('otel sdk exploded') }),
      }) as any)
    }

    it('endSuccess swallows span.end throws and warns with agentId + conversationId + telemetryError', () => {
      mockThrowingSpan()
      const inv = createAgentInvocation({
        agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
        agentName: 'develop',
        prompt: 'hi',
        conversationId: 'conv_1',
        logger,
      })
      expect(() => inv.endSuccess({ outputText: 'ok', responseType: 'llm_reply' })).not.toThrow()
      expect(logger.warn).toHaveBeenCalledWith('agent.invocation.end_failed', {
        conversationId: 'conv_1',
        agentId: 'airo-app-builder-develop',
        telemetryError: 'otel sdk exploded',
      })
      expect(inv.ended).toBe(true)
    })

    it('endError swallows span.end throws (preserves original error propagation to caller)', () => {
      mockThrowingSpan()
      const inv = createAgentInvocation({
        agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
        agentName: 'develop',
        prompt: 'hi',
        conversationId: 'conv_1',
        logger,
      })
      // The caller's pattern is: catch(err) { inv.endError(err); throw err }.
      // If endError throws, the original error is replaced — critical to guard.
      expect(() => inv.endError(new Error('original'))).not.toThrow()
      expect(logger.warn).toHaveBeenCalledWith(
        'agent.invocation.end_failed',
        expect.objectContaining({ telemetryError: 'otel sdk exploded' }),
      )
    })

    it('falls back to console.error when both span.end and logger.warn throw', () => {
      mockThrowingSpan()
      const throwingLogger = { warn: vi.fn(() => { throw new Error('logger broken') }) }
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const inv = createAgentInvocation({
          agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
          agentName: 'develop',
          prompt: 'hi',
          conversationId: 'conv_1',
          logger: throwingLogger,
        })
        expect(() => inv.endAborted({ outputText: '', responseType: 'tool_call' })).not.toThrow()
        expect(consoleErrorSpy).toHaveBeenCalledWith('agent.invocation.end_failed', expect.objectContaining({
          conversationId: 'conv_1',
          agentId: 'airo-app-builder-develop',
          telemetryError: 'otel sdk exploded',
        }))
      } finally {
        consoleErrorSpy.mockRestore()
      }
    })

    it('omits conversationId from the warn payload when none was supplied', () => {
      mockThrowingSpan()
      const inv = createAgentInvocation({
        agent: { getConfig: () => ({ modelName: 'claude-sonnet-4-6' }) },
        agentName: 'develop',
        prompt: 'hi',
        logger,
      })
      inv.endSuccess({ outputText: '', responseType: 'tool_call' })
      const payload = (logger.warn as any).mock.calls[0][1]
      expect(payload).not.toHaveProperty('conversationId')
      expect(payload).toMatchObject({ agentId: 'airo-app-builder-develop' })
    })
  })
})
