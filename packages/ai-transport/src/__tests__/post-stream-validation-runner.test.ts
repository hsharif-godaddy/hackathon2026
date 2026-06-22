import { describe, expect, it, vi } from 'vitest'
import {
  runPostStreamValidation,
  turnEndedWithStopAfterTool,
  type PostStreamValidatorFn,
  type PostStreamValidatorInput,
  type ValidationMessageEventData,
} from '../post-stream-validation-runner.js'

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function makePublishCapture() {
  const calls: Array<{ content: string; data: ValidationMessageEventData }> = []
  const publish = vi.fn(async function (content: string, data: ValidationMessageEventData) {
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
  emitChunk: vi.fn(async function () {}),
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
    const persist = vi.fn(async function () { return 'persisted-msg-123'; })
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

  // Suggestion 2: pin the stopAfterTools forwarding contract at the runner
  // seam. Per ai-transport/CLAUDE.md, shared behaviour belongs in shared
  // package tests, not just covered transitively via transport tests.
  it('forwards stopAfterTools to the validator when provided', async () => {
    let capturedInput: PostStreamValidatorInput | undefined
    const validator: PostStreamValidatorFn = async (input) => {
      capturedInput = input
      return undefined
    }

    await runPostStreamValidation({
      ...baseParams(),
      stopAfterTools: ['askQuestion'],
      validator,
      publishValidationMessage: vi.fn(async () => true),
    })

    expect(capturedInput?.stopAfterTools).toEqual(['askQuestion'])
  })

  it('omits stopAfterTools key from validator input when not provided', async () => {
    // The conditional spread `...(stopAfterTools !== undefined && { stopAfterTools })`
    // must produce an absent key, not present-and-undefined, so the validator
    // can distinguish "transport didn't supply it" from "explicitly empty".
    let capturedInput: PostStreamValidatorInput | undefined
    const validator: PostStreamValidatorFn = async (input) => {
      capturedInput = input
      return undefined
    }

    await runPostStreamValidation({
      ...baseParams(),
      validator,
      publishValidationMessage: vi.fn(async () => true),
    })

    expect('stopAfterTools' in (capturedInput ?? {})).toBe(false)
  })

  // AIROBUILD-2665: the forced design-kit install turn forwards
  // `forcedInstallThisTurn` to the validator so it can grant that single turn
  // validator-immunity (skip on the stop-after interview turn even with a
  // dirty tree). Pin the forwarding contract at the runner seam.
  it('forwards forcedInstallThisTurn to the validator when provided', async () => {
    let capturedInput: PostStreamValidatorInput | undefined
    const validator: PostStreamValidatorFn = async (input) => {
      capturedInput = input
      return undefined
    }

    await runPostStreamValidation({
      ...baseParams(),
      forcedInstallThisTurn: true,
      validator,
      publishValidationMessage: vi.fn(async () => true),
    })

    expect(capturedInput?.forcedInstallThisTurn).toBe(true)
  })

  it('omits forcedInstallThisTurn key from validator input when not provided', async () => {
    // Conditional spread must produce an absent key, not present-and-undefined,
    // matching the stopAfterTools forwarding convention.
    let capturedInput: PostStreamValidatorInput | undefined
    const validator: PostStreamValidatorFn = async (input) => {
      capturedInput = input
      return undefined
    }

    await runPostStreamValidation({
      ...baseParams(),
      validator,
      publishValidationMessage: vi.fn(async () => true),
    })

    expect('forcedInstallThisTurn' in (capturedInput ?? {})).toBe(false)
  })

  // AIROBUILD-2665: `stop_after_forced_install` is a benign clean skip — the
  // runner must treat it like `stop_after_no_changes` / `no_uncommitted_changes`:
  // no status events, no warn log, no continuation, returns null.
  it('emits no status events and returns null for stop_after_forced_install skip', async () => {
    const { publish, calls } = makePublishCapture()
    const logger = makeLogger()
    const validator: PostStreamValidatorFn = async () => ({
      skipped: true,
      reason: 'stop_after_forced_install'
    })

    const result = await runPostStreamValidation({
      ...baseParams(),
      validator,
      logger,
      publishValidationMessage: publish,
    })

    expect(result).toBeNull()
    expect(calls).toHaveLength(0)
    expect(logger.warn).not.toHaveBeenCalledWith(
      'post_stream_validator.unhandled_skipped_result',
      expect.anything()
    )
  })

  // Step D: helper-level coverage for the `stop_after_no_changes` skip reason.
  // The validator returns this when the turn ended with a stop-after tool AND
  // the working tree is clean — the preserved PR #3985 intent. The runner
  // must treat it as a silent clean skip: no status events, no warn log, no
  // continuation. Mirrors the existing `no_uncommitted_changes` behavior.
  it('emits no status events and returns null for stop_after_no_changes skip', async () => {
    const { publish, calls } = makePublishCapture()
    const logger = makeLogger()
    const validator: PostStreamValidatorFn = async () => ({
      skipped: true,
      reason: 'stop_after_no_changes'
    })

    const result = await runPostStreamValidation({
      ...baseParams(),
      validator,
      logger,
      publishValidationMessage: publish,
    })

    expect(result).toBeNull()
    expect(calls).toHaveLength(0)
    expect(logger.warn).not.toHaveBeenCalledWith(
      'post_stream_validator.unhandled_skipped_result',
      expect.anything()
    )
  })

  it('emits no status events and returns null for no_uncommitted_changes skip', async () => {
    const { publish, calls } = makePublishCapture()
    const logger = makeLogger()
    const validator: PostStreamValidatorFn = async () => ({
      skipped: true,
      reason: 'no_uncommitted_changes'
    })

    const result = await runPostStreamValidation({
      ...baseParams(),
      validator,
      logger,
      publishValidationMessage: publish,
    })

    expect(result).toBeNull()
    expect(calls).toHaveLength(0)
    expect(logger.warn).not.toHaveBeenCalledWith(
      'post_stream_validator.unhandled_skipped_result',
      expect.anything()
    )
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
    const persist = vi.fn(async function () { return 'id'; })
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
    const persist = vi.fn(async function () { return 'persisted-id'; })
    const logger = makeLogger()
    // emitValidationStart succeeds; the follow-up 'failed' publish throws.
    const publish = vi.fn()
      .mockImplementationOnce(async function () { return true; })
      .mockImplementationOnce(async function () { throw new Error('channel dropped') })

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
    const persist = vi.fn(async function () { throw new Error('db down') })
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
