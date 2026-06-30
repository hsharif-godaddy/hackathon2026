import type { TextStreamPart, ToolSet } from 'ai'

/** Options for {@link createObservingTransform}. */
export interface ObservingTransformOptions<TOOLS extends ToolSet> {
  /** Called for every part as it passes through, in stream order, before the
   * part is forwarded to the AI SDK's own consumer. May be async — awaiting it
   * backpressures the SDK loop until the side-effect (e.g. SSE emit) completes. */
  observe: (part: TextStreamPart<TOOLS>) => void | Promise<void>
  /** Called once with the extracted Error when a terminal `error` part passes
   * through, immediately before the stream is stopped. Lets the caller abort
   * the shared request and surface the original error for classification. */
  onTerminalError: (error: Error) => void
}

/** Coerce an AI SDK `error` part's `.error` payload to an Error, preserving a
 * structured `{ message }` so a `{ message, statusCode }` envelope keeps its
 * text instead of stringifying to '[object Object]'. Mirrors
 * `@airo/ai-transport`'s `extractToolError`, plus attaches the raw payload as
 * `cause` on the synthesized-Error fallbacks so odd shapes (e.g. `{ code: 502 }`)
 * stay inspectable for triage.
 *
 * For object payloads, `statusCode`/`responseBody` are also lifted onto the
 * synthesized Error's TOP LEVEL. Downstream classifiers read them there, not off
 * `.cause` — `isUpstreamTimeoutError`/`analyzeStreamError` (analyze-stream-error.ts)
 * key on a top-level `statusCode` — so without this an in-band
 * `{ message, statusCode: 408, responseBody }` envelope would miss the 408/504
 * soft-commit seam and log `undefined`. (TODO: the field-lifting + text-extraction
 * is shared with `@airo/ai-transport`'s `extractToolError`; lift a single
 * `coerceToError` into `@airo/ai-common` — see AIROBUILD-3145.) */
function extractStreamError(raw: unknown): Error {
  if (raw instanceof Error) return raw
  if (typeof raw === 'string') return new Error(raw || 'Stream error')
  if (raw && typeof raw === 'object') {
    const message: unknown = (raw as { message?: unknown }).message
    const text: string = typeof message === 'string' && message.length > 0 ? message : 'Stream error'
    const statusCode: unknown = (raw as { statusCode?: unknown }).statusCode
    const responseBody: unknown = (raw as { responseBody?: unknown }).responseBody
    return Object.assign(new Error(text, { cause: raw }), {
      ...(typeof statusCode === 'number' && { statusCode }),
      ...(responseBody !== undefined && { responseBody }),
    })
  }
  return new Error('Stream error', { cause: raw })
}

/** Build a passthrough `experimental_transform` for `agent.stream` that observes
 * each part as the AI SDK consumes the stream. On a terminal `error` part it
 * calls `onTerminalError` and the SDK's `stopStream`, halting the multi-step
 * loop at the source. The transform passes every part through unchanged, so it
 * coexists with any tee the SDK exposes internally; the chat path consumes only
 * this observed stream (via `observe`) and no longer reads `baseStream`. */
export function createObservingTransform<TOOLS extends ToolSet>(
  options: ObservingTransformOptions<TOOLS>,
): (args: { tools: TOOLS; stopStream: () => void }) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> {
  return ({ stopStream }: { tools: TOOLS; stopStream: () => void }): TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      async transform(
        part: TextStreamPart<TOOLS>,
        controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
      ): Promise<void> {
        // Forward the part and run terminal-error handling in `finally` so a
        // throwing/rejecting `observe` (e.g. a failing SSE emit once a real
        // observer is wired) can neither drop the part from the SDK consumer nor
        // suppress the terminal abort. Awaiting observe still backpressures the
        // loop; the no-op default skips the await to stay on the synchronous path.
        try {
          const observed: void | Promise<void> = options.observe(part)
          if (observed) await observed
        } finally {
          controller.enqueue(part)
          if (part.type === 'error') {
            options.onTerminalError(extractStreamError((part as { error?: unknown }).error))
            stopStream()
          }
        }
      },
    })
}

/** The three values `agent.stream` wiring needs from a single observed stream:
 * the transform to pass as `experimental_transform`, the abort signal to pass
 * as `abortSignal`, and the captured terminal error (if any) to re-throw for
 * downstream classification. */
export interface TerminalAbortPipeline<TOOLS extends ToolSet> {
  experimental_transform: (args: { tools: TOOLS; stopStream: () => void }) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>
  /** Aborts when the caller's signal aborts (Stop / shutdown / chunk-timeout)
   * OR when a terminal `error` part is observed. Hand this to `agent.stream`. */
  signal: AbortSignal
  /** The error from the first terminal `error` part observed, else undefined. */
  getTerminalError: () => Error | undefined
}

/** Bundle the observation pipeline `agent.stream` wiring needs: a passthrough
 * transform that feeds `observe` and, on a terminal `error` part, aborts an
 * internal controller (composed with the caller's signal so either source halts
 * the SDK loop) and captures the original error for re-throw. The abort halts
 * the multi-step loop regardless of any other consumer. The chat path drives its
 * SSE side-effects from `observe` and consumes only this stream. */
export function createTerminalAbortPipeline<TOOLS extends ToolSet>(opts: {
  observe?: (part: TextStreamPart<TOOLS>) => void | Promise<void>
  callerSignal?: AbortSignal
}): TerminalAbortPipeline<TOOLS> {
  const internal: AbortController = new AbortController()
  const terminal: { error?: Error } = {}
  const observe: (part: TextStreamPart<TOOLS>) => void | Promise<void> = opts.observe ?? ((): void => {})

  const experimental_transform: (args: { tools: TOOLS; stopStream: () => void }) => TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>> = createObservingTransform<TOOLS>({
    observe,
    onTerminalError: (error: Error): void => {
      if (!terminal.error) terminal.error = error
      if (!internal.signal.aborted) internal.abort(error)
    },
  })

  const signal: AbortSignal = opts.callerSignal
    ? AbortSignal.any([opts.callerSignal, internal.signal])
    : internal.signal

  return {
    experimental_transform,
    signal,
    getTerminalError: (): Error | undefined => terminal.error,
  }
}
