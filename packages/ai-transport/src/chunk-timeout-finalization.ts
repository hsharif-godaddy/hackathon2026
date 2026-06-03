/** Outcome of a chunk-timeout abort: how to finalize the turn.
 *
 * - `finalize` with `finishReason: 'stop'`  — a terminal `finish` frame was
 *   seen before the stall; treat as a genuine completion.
 * - `finalize` with `finishReason: 'incomplete'` — no terminal frame, but
 *   content already streamed; soft-commit what arrived (client maps
 *   'incomplete' → connectionLost advisory). Effectively unbilled, since
 *   `getFinalResult()` is skipped and no usage is captured.
 * - `fail` — nothing arrived; fail fast on the existing error path. */
export type ChunkTimeoutOutcome =
  | { kind: 'finalize'; finishReason: 'stop' | 'incomplete' }
  | { kind: 'fail' }

/** Decide how a `chunk_timeout`-aborted turn should finalize. Pure: callers
 * supply the processor's terminal-frame state and whether any content has
 * accumulated. Shared by SSE (`MessageExecutionService`) and WS
 * (`experimental-websocket-server`) so the two transports stay identical.
 *
 * Note: the WebSocket transport computes finishReason outside the processor
 * scope and passes `isFinished: false`, so on WS this helper only ever returns
 * `'incomplete'` or `fail` (never `'stop'`). SSE passes the real
 * `processor.isFinished()`. For the targeted GoCode stall (idle after the full
 * response, no terminal `finish` frame), both transports take the
 * `'incomplete'`/`fail` paths, so they agree in practice. */
export function decideChunkTimeoutFinalization(input: {
  isFinished: boolean
  hasContent: boolean
}): ChunkTimeoutOutcome {
  if (input.isFinished) return { kind: 'finalize', finishReason: 'stop' }
  if (input.hasContent) return { kind: 'finalize', finishReason: 'incomplete' }
  return { kind: 'fail' }
}
