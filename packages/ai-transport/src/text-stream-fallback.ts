/**
 * Shared text-stream fallback for when the base ReadableStream fails mid-read.
 * Both WS and SSE transports use this to recover partial content by falling
 * back to the AI SDK's textStream async iterable.
 */

export interface TextStreamFallbackDeps {
  textStream: AsyncIterable<string>
  abortSignal: AbortSignal
  onChunk: (text: string) => void | Promise<void>
  tracker: { recordChunk(): void }
  guard?: { reset(): void } | undefined
}

/**
 * Read from textStream as a fallback when baseStream fails mid-read.
 * Iterates the text stream, calling onChunk for each chunk while respecting
 * the abort signal. Throws on non-abort errors so callers can propagate.
 * Returns normally on stream completion or abort.
 */
export async function readTextStreamFallback(deps: TextStreamFallbackDeps): Promise<void> {
  const { textStream, abortSignal, onChunk, tracker, guard } = deps

  for await (const chunk of textStream) {
    if (abortSignal.aborted) break
    tracker.recordChunk()
    guard?.reset()
    await onChunk(chunk)
  }
}
