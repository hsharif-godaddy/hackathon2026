/** Returns true when the last tool call's name matches a configured stop-after tool,
 *  meaning the agent intentionally paused for user interaction and post-stream
 *  validation should be skipped. */
export function turnEndedWithStopAfterTool(
  toolCalls: Array<{ toolName: string }>,
  stopAfterTools: string[] | undefined,
): boolean {
  if (!stopAfterTools || stopAfterTools.length === 0 || toolCalls.length === 0) return false
  const lastTool = toolCalls[toolCalls.length - 1]!
  return stopAfterTools.includes(lastTool.toolName)
}

export type ValidationStatus = 'running' | 'completed' | 'failed' | 'error'

export interface ValidationMessageEventData {
  validationId: string
  messageId?: string
  role?: 'user'
  metadata: {
    source: 'post_stream_validator'
    displayAs: 'validation'
    validationStatus: ValidationStatus
  }
  agentId: string
}

export interface PostStreamValidatorInput {
  socketId: string
  context: Record<string, unknown>
  agentName: string
  toolCalls: Array<{ toolName: string; args?: unknown }>
  abortSignal: AbortSignal
  emitChunk: (text: string) => Promise<void>
  emitValidationStart?: () => Promise<void>
}

export type PostStreamValidatorResult =
  | { continuationPrompt: string; message?: string }
  | { skipped: true; reason: string; message?: string }
  | undefined

export type PostStreamValidatorFn = (
  input: PostStreamValidatorInput,
) => Promise<PostStreamValidatorResult>

export interface PostStreamValidationLogger {
  info: (event: string, fields: Record<string, unknown>) => void
  warn: (event: string, fields: Record<string, unknown>) => void
  error: (event: string, fields: Record<string, unknown>) => void
}

export interface RunPostStreamValidationParams {
  validator: PostStreamValidatorFn
  socketId: string
  agentName: string
  context: Record<string, unknown>
  toolCalls: Array<{ toolName: string; args?: unknown }>
  abortSignal: AbortSignal
  iteration: number
  /** Publish a `chunk` event appended to the in-flight assistant message. */
  emitChunk: (text: string) => Promise<void>
  /** Publish a `validation_message` event. Return true when the event was delivered. */
  publishValidationMessage: (
    content: string,
    data: ValidationMessageEventData,
  ) => Promise<boolean>
  /** Persist the continuation prompt as a user message so it renders in history. */
  persistValidationMessage?: (continuationPrompt: string) => Promise<string | undefined>
  logger: PostStreamValidationLogger
  /** Per-call extra fields to attach to every log event. */
  logContext?: Record<string, unknown>
}

export interface RunPostStreamValidationResult {
  continuationPrompt: string
  message: string
}

/**
 * Returns `{ continuationPrompt, message }` when the validator asks for a
 * retry; `null` otherwise. Never throws — validator errors are logged and
 * emitted as `validation_message` `error` events.
 */
export async function runPostStreamValidation(
  params: RunPostStreamValidationParams,
): Promise<RunPostStreamValidationResult | null> {
  const {
    validator, socketId, agentName, context, toolCalls, abortSignal, iteration,
    emitChunk, publishValidationMessage, persistValidationMessage, logger, logContext,
  } = params

  const validationId = `post_stream_validation_${iteration}_${Date.now()}`
  let validationStarted = false

  const emitStatus = async (status: ValidationStatus, content: string, extra?: { messageId?: string; role?: 'user' }): Promise<boolean> => {
    return publishValidationMessage(content, {
      validationId,
      ...(extra?.messageId !== undefined && { messageId: extra.messageId }),
      ...(extra?.role && { role: extra.role }),
      metadata: {
        source: 'post_stream_validator',
        displayAs: 'validation',
        validationStatus: status,
      },
      agentId: agentName,
    })
  }

  try {
    const validatorResult = await validator({
      socketId,
      context,
      agentName,
      toolCalls,
      abortSignal,
      emitChunk,
      emitValidationStart: async () => {
        validationStarted = await emitStatus('running', 'Validating code...')
      },
    })

    if (
      validatorResult &&
      typeof validatorResult === 'object' &&
      typeof (validatorResult as { continuationPrompt?: unknown }).continuationPrompt === 'string' &&
      !abortSignal.aborted
    ) {
      const continuationPrompt = (validatorResult as { continuationPrompt: string }).continuationPrompt
      const message = typeof (validatorResult as { message?: unknown }).message === 'string'
        ? (validatorResult as { message: string }).message
        : continuationPrompt

      let validationMessageId: string | undefined
      if (persistValidationMessage) {
        try {
          validationMessageId = await persistValidationMessage(continuationPrompt)
        } catch (persistenceError) {
          logger.error('post_stream_validator.persistence_failure', {
            ...(logContext ?? {}),
            socketId,
            agentName,
            error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
          })
        }
      }

      if (validationStarted) {
        // Must not throw: persistValidationMessage may have already committed
        // the continuation user message to the DB, so a rejection here would
        // orphan that message (caller relies on our return to run the
        // continuation turn).
        try {
          await emitStatus('failed', message, {
            ...(validationMessageId !== undefined && { messageId: validationMessageId }),
            role: 'user',
          })
        } catch (publishError) {
          logger.warn('post_stream_validator.status_publish_failure', {
            ...(logContext ?? {}),
            socketId,
            agentName,
            status: 'failed',
            error: publishError instanceof Error ? publishError.message : String(publishError),
          })
        }
      }

      return { continuationPrompt, message }
    }

    if (!abortSignal.aborted && validationStarted) {
      const skippedResult = validatorResult &&
        typeof validatorResult === 'object' &&
        (validatorResult as { skipped?: unknown }).skipped === true
          ? validatorResult as { skipped: true; reason: string; message?: string }
          : undefined
      if (skippedResult?.reason === 'exhausted') {
        await emitStatus('error', 'Validation could not resolve all issues.')
      } else if (!skippedResult) {
        await emitStatus('completed', 'No issues found.')
      } else {
        logger.warn('post_stream_validator.unhandled_skipped_result', {
          ...(logContext ?? {}),
          socketId,
          agentName,
          reason: skippedResult.reason,
        })
        await emitStatus('error', 'Validation stopped before completing.')
      }
    }

    return null
  } catch (validatorError) {
    // Validator is additive; failures must never block message completion.
    // Record every throw — an abort-concurrent throw gets an info-level
    // event (expected) while a genuine validator bug gets an error
    // (investigate). Losing either to an unconditional early-return would
    // mean silent data loss on races.
    const errMsg = validatorError instanceof Error ? validatorError.message : String(validatorError)
    const errStack = validatorError instanceof Error ? validatorError.stack : undefined

    if (abortSignal.aborted) {
      logger.info('post_stream_validator.aborted', {
        ...(logContext ?? {}),
        socketId,
        agentName,
        error: errMsg,
      })
      return null
    }

    logger.error('post_stream_validator.failure', {
      ...(logContext ?? {}),
      socketId,
      agentName,
      error: errMsg,
      stack: errStack,
    })

    if (validationStarted) {
      try {
        await emitStatus('error', errMsg)
      } catch (publishError) {
        logger.warn('post_stream_validator.error_publish_failure', {
          ...(logContext ?? {}),
          socketId,
          agentName,
          error: publishError instanceof Error ? publishError.message : String(publishError),
        })
      }
    }

    return null
  }
}
