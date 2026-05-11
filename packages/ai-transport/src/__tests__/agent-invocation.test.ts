import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@godaddy/agent-otel-sdk', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@godaddy/agent-otel-sdk')
  return {
    ...actual,
    emitError: vi.fn(),
  }
})
vi.mock('@godaddy/agent-observability-events', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@godaddy/agent-observability-events')
  return {
    ...actual,
    createError: vi.fn((input: unknown) => ({ kind: 'error', input })),
  }
})

import { emitError } from '@godaddy/agent-otel-sdk'
import { createError } from '@godaddy/agent-observability-events'
import { formatAgentId, emitTurnError } from '../agent-invocation.js'

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
