import { describe, expect, it, vi } from 'vitest'
import {
  runPostStreamValidation,
  turnEndedWithStopAfterTool,
  type PostStreamValidatorFn,
  type ValidationMessageEventData,
} from '../post-stream-validation-runner.js'

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makePublishCapture() {
  const calls: Array<{ content: string; data: ValidationMessageEventData }> = []
  const publish = vi.fn(async (content: string, data: ValidationMessageEventData) => {
    calls.push({ content, data })
    return true
  })
  return { publish, calls }
}

const baseParams = () => ({
  socketId: 'sock-1',
  agentName: 'develop',
  context: {},
  toolCalls: [{ toolName: 'write_file' }],
  abortSignal: new AbortController().signal,
  iteration: 0,
  emitChunk: vi.fn(async () => {}),
  logger: makeLogger(),
})

describe('runPostStreamValidation', () => {
  it('emits running + completed when validator passes cleanly', async () => {
    const { publish, calls } = makePublishCapture()
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      return undefined
    }

    const result = await runPostStreamValidation({
      ...baseParams(),
      validator,
      publishValidationMessage: publish,
    })

    expect(result).toBeNull()
    expect(calls.map(c => c.data.metadata.validationStatus)).toEqual(['running', 'completed'])
    expect(calls[1]?.content).toBe('No issues found.')
  })

  it('emits running + failed and persists when validator returns continuation', async () => {
    const { publish, calls } = makePublishCapture()
    const persist = vi.fn(async () => 'persisted-msg-123')
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      return { continuationPrompt: 'fix the type error', message: 'tsc reported 1 error' }
    }

    const result = await runPostStreamValidation({
      ...baseParams(),
      validator,
      publishValidationMessage: publish,
      persistValidationMessage: persist,
    })

    expect(persist).toHaveBeenCalledWith('fix the type error')
    expect(result).toEqual({ continuationPrompt: 'fix the type error', message: 'tsc reported 1 error' })
    expect(calls[0]?.data.metadata.validationStatus).toBe('running')
    expect(calls[1]?.data.metadata.validationStatus).toBe('failed')
    expect(calls[1]?.content).toBe('tsc reported 1 error')
    expect(calls[1]?.data.messageId).toBe('persisted-msg-123')
    expect(calls[1]?.data.role).toBe('user')
  })

  it('falls back to continuationPrompt for message when validator omits it', async () => {
    const { publish, calls } = makePublishCapture()
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      return { continuationPrompt: 'just do it' }
    }

    const result = await runPostStreamValidation({
      ...baseParams(),
      validator,
      publishValidationMessage: publish,
    })

    expect(result?.message).toBe('just do it')
    expect(calls[1]?.content).toBe('just do it')
  })

  it('emits error with exhausted copy when validator reports skipped:exhausted', async () => {
    const { publish, calls } = makePublishCapture()
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      return { skipped: true, reason: 'exhausted' }
    }

    const result = await runPostStreamValidation({
      ...baseParams(),
      validator,
      publishValidationMessage: publish,
    })

    expect(result).toBeNull()
    expect(calls[1]?.content).toBe('Validation could not resolve all issues.')
    expect(calls[1]?.data.metadata.validationStatus).toBe('error')
  })

  it('emits error + warns for unhandled skipped reasons', async () => {
    const { publish, calls } = makePublishCapture()
    const logger = makeLogger()
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      return { skipped: true, reason: 'unknown' }
    }

    await runPostStreamValidation({
      ...baseParams(),
      logger,
      validator,
      publishValidationMessage: publish,
    })

    expect(logger.warn).toHaveBeenCalledWith('post_stream_validator.unhandled_skipped_result',
      expect.objectContaining({ reason: 'unknown' }))
    expect(calls[1]?.content).toBe('Validation stopped before completing.')
  })

  it('does not emit status events when validator never called emitValidationStart', async () => {
    const { publish, calls } = makePublishCapture()
    const validator: PostStreamValidatorFn = async () => undefined

    await runPostStreamValidation({
      ...baseParams(),
      validator,
      publishValidationMessage: publish,
    })

    expect(calls).toHaveLength(0)
  })

  it('logs info (not error) and skips error publish when validator throws post-abort', async () => {
    const { publish } = makePublishCapture()
    const controller = new AbortController()
    const logger = makeLogger()
    const validator: PostStreamValidatorFn = async ({ emitValidationStart, abortSignal }) => {
      await emitValidationStart?.()
      controller.abort()
      // Simulate the validator noticing the abort and throwing
      if (abortSignal.aborted) throw new Error('aborted by signal')
      return undefined
    }

    await runPostStreamValidation({
      ...baseParams(),
      abortSignal: controller.signal,
      logger,
      validator,
      publishValidationMessage: publish,
    })

    expect(logger.info).toHaveBeenCalledWith('post_stream_validator.aborted',
      expect.objectContaining({ error: 'aborted by signal' }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('publishes error status when validator throws after emitValidationStart', async () => {
    const { publish, calls } = makePublishCapture()
    const logger = makeLogger()
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      throw new Error('tsc crashed')
    }

    await runPostStreamValidation({
      ...baseParams(),
      logger,
      validator,
      publishValidationMessage: publish,
    })

    expect(logger.error).toHaveBeenCalledWith('post_stream_validator.failure',
      expect.objectContaining({ error: 'tsc crashed' }))
    expect(calls[1]?.data.metadata.validationStatus).toBe('error')
    expect(calls[1]?.content).toBe('tsc crashed')
  })

  it('suppresses continuation side effects when abort fires between validator return and post-processing', async () => {
    const { publish, calls } = makePublishCapture()
    const persist = vi.fn(async () => 'id')
    const controller = new AbortController()
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      controller.abort()
      return { continuationPrompt: 'retry' }
    }

    const result = await runPostStreamValidation({
      ...baseParams(),
      abortSignal: controller.signal,
      validator,
      publishValidationMessage: publish,
      persistValidationMessage: persist,
    })

    expect(result).toBeNull()
    expect(persist).not.toHaveBeenCalled()
    // Only the running status should have been emitted; aborted path drops the follow-up.
    expect(calls.map(c => c.data.metadata.validationStatus)).toEqual(['running'])
  })

  it('returns the continuation even when the failed-status publish rejects after persist', async () => {
    const persist = vi.fn(async () => 'persisted-id')
    const logger = makeLogger()
    // emitValidationStart succeeds; the follow-up 'failed' publish throws.
    const publish = vi.fn()
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => { throw new Error('channel dropped') })

    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      return { continuationPrompt: 'retry', message: 'retry plz' }
    }

    const result = await runPostStreamValidation({
      ...baseParams(),
      logger,
      validator,
      publishValidationMessage: publish,
      persistValidationMessage: persist,
    })

    expect(result).toEqual({ continuationPrompt: 'retry', message: 'retry plz' })
    expect(persist).toHaveBeenCalledWith('retry')
    expect(logger.warn).toHaveBeenCalledWith('post_stream_validator.status_publish_failure',
      expect.objectContaining({ status: 'failed', error: 'channel dropped' }))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('swallows persistence errors and still emits failed status without messageId', async () => {
    const { publish, calls } = makePublishCapture()
    const logger = makeLogger()
    const persist = vi.fn(async () => { throw new Error('db down') })
    const validator: PostStreamValidatorFn = async ({ emitValidationStart }) => {
      await emitValidationStart?.()
      return { continuationPrompt: 'retry', message: 'retry plz' }
    }

    const result = await runPostStreamValidation({
      ...baseParams(),
      logger,
      validator,
      publishValidationMessage: publish,
      persistValidationMessage: persist,
    })

    expect(result).toEqual({ continuationPrompt: 'retry', message: 'retry plz' })
    expect(logger.error).toHaveBeenCalledWith('post_stream_validator.persistence_failure',
      expect.objectContaining({ error: 'db down' }))
    expect(calls[1]?.data.metadata.validationStatus).toBe('failed')
    expect(calls[1]?.data.messageId).toBeUndefined()
  })
})

describe('turnEndedWithStopAfterTool', () => {
  it('returns true when last tool is in stopAfterTools', () => {
    const toolCalls = [{ toolName: 'editFile' }, { toolName: 'askQuestion' }]
    expect(turnEndedWithStopAfterTool(toolCalls, ['askQuestion', 'handoff'])).toBe(true)
  })

  it('returns false when last tool is not in stopAfterTools', () => {
    const toolCalls = [{ toolName: 'askQuestion' }, { toolName: 'editFile' }]
    expect(turnEndedWithStopAfterTool(toolCalls, ['askQuestion', 'handoff'])).toBe(false)
  })

  it('returns false when stopAfterTools is undefined', () => {
    expect(turnEndedWithStopAfterTool([{ toolName: 'askQuestion' }], undefined)).toBe(false)
  })

  it('returns false when stopAfterTools is empty', () => {
    expect(turnEndedWithStopAfterTool([{ toolName: 'askQuestion' }], [])).toBe(false)
  })

  it('returns false when toolCalls is empty', () => {
    expect(turnEndedWithStopAfterTool([], ['askQuestion'])).toBe(false)
  })

  it('returns true for handoff as last tool', () => {
    const toolCalls = [{ toolName: 'editFile' }, { toolName: 'handoff' }]
    expect(turnEndedWithStopAfterTool(toolCalls, ['askQuestion', 'handoff'])).toBe(true)
  })

  it('returns false when stop-after tool is not the last call', () => {
    const toolCalls = [{ toolName: 'handoff' }, { toolName: 'editFile' }]
    expect(turnEndedWithStopAfterTool(toolCalls, ['askQuestion', 'handoff'])).toBe(false)
  })
})
