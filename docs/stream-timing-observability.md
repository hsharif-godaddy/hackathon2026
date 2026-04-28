# Stream Timing Observability

How to access stream timing logs in production and use them to calibrate
the chunk timeout threshold.

---

## What Is Logged

Every successful AI stream emits a `stream.timing.summary` event at `info`
level when the stream completes. Like `token.usage`, it is logged via the
agents structured logger and is queryable in Grafana Loki.

**Event:** `stream.timing.summary`
**Level:** `info`
**Source:** `packages/ai-transport/src/experimental-websocket-server.ts`

### Fields

| Field                    | Type           | Description                                                                                            |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| `socketId`               | string         | WebSocket connection ID                                                                                |
| `agentName`              | string         | Agent that ran the stream                                                                              |
| `modelName`              | string         | LLM model used                                                                                         |
| `appId`                  | string         | App scoping the stream                                                                                 |
| `timeToStreamStartMs`    | number         | Time from request receipt to start of chunk reading, including LLM API call latency to open the stream |
| `streamProcessingMs`     | number         | Time spent consuming stream chunks                                                                     |
| `getFinalResultMs`       | number         | Time spent in `getFinalResult()` after stream ends                                                     |
| `timeToFirstTextChunkMs` | number \| null | Time from stream start to first text chunk (null if no text)                                           |
| `maxChunkGapMs`          | number         | Largest gap between consecutive chunks during this stream                                              |
| `chunksRead`             | number         | Total chunks received                                                                                  |
| `streamDurationMs`       | number         | Elapsed time from start of chunk reading to stream completion (tracker creation to finalize)           |

The key field for timeout calibration is **`maxChunkGapMs`** — the largest
inter-chunk gap observed on a stream that completed successfully.

---

## Related Events

### `stream.chunk.gap_warning`

Emitted at `warn` level by `ChunkTimeoutGuard` at escalating elapsed-time
thresholds defined by `CHUNK_GAP_WARNING_THRESHOLDS_MS` in
`packages/ai-transport/src/chunk-timeout-guard.ts`. These fire before the
chunk timeout aborts the stream, giving operators advance notice of a stall.

**Source:** `packages/ai-transport/src/chunk-timeout-guard.ts`
**Level:** `warn`

Fields: `socketId`, `agentName`, `modelName`, `elapsedMs`, `timeoutMs`

### `stream.chunk.slow_gap`

Emitted at `warn` level mid-stream when a single chunk gap exceeds
`SLOW_CHUNK_GAP_THRESHOLD_MS` (see `stream-timing-tracker.ts` for current
value). Fires during the stream, not at completion.

**Source:** `packages/ai-transport/src/stream-timing-tracker.ts`
**Level:** `warn`

Fields: `socketId`, `agentName`, `modelName`, `gapMs`, `chunksRead`,
`streamElapsedMs`

### `stream.tool.slow_execution`

Emitted at `warn` level by `StreamTimingTracker.resumeGapTracking()` when
a tool execution exceeds `SLOW_CHUNK_GAP_THRESHOLD_MS` (see
`stream-timing-tracker.ts` for current value). Fires once per tool call
when resuming gap tracking after the tool completes.

**Source:** `packages/ai-transport/src/stream-timing-tracker.ts`
**Level:** `warn`

Fields: `socketId`, `agentName`, `modelName`, `toolName`,
`toolDurationMs`

### `stream.chunk.timeout`

Emitted at `warn` level by `StreamTimingTracker.recordTimeout()` when the
stream times out. Captures full stream diagnostics.

**Source:** `packages/ai-transport/src/stream-timing-tracker.ts`
**Level:** `warn`

Fields: `socketId`, `agentName`, `modelName`, `error`, `chunksRead`,
`streamElapsedMs`, `timeToFirstTextChunkMs`, `maxChunkGapMs`

### `stream.chunk.timeout.transport`

Emitted at `warn` level by `ChunkTimeoutGuard` when the chunk timeout
fires and aborts the per-socket AbortController. The timeout value in
effect is the `AI_CHUNK_TIMEOUT_MS` environment variable (see the Tuning
section).

**Source:** `packages/ai-transport/src/chunk-timeout-guard.ts`
**Level:** `warn`

Fields: `socketId`, `agentName`, `modelName`, `timeoutMs`

---

## Timeout Pause Behavior

The chunk timeout guard **pauses during tool execution**. When the AI SDK
invokes a tool, `StreamTimingTracker.pauseGapTracking()` nulls the
last-chunk timestamp and `ChunkTimeoutGuard.pause()` clears the active
timer. Both resume when the tool completes and streaming resumes.

This means wall-clock time for a stream can exceed the configured chunk
timeout without firing `stream.chunk.timeout.transport`. For example, a
stream with an 11 min timeout that executes three 5 min tool calls will
run for ~26 min total wall-clock time without triggering an abort, because
the 15 min of tool execution is excluded from the inter-chunk gap
measurement.

If a tool itself runs too long, the `stream.tool.slow_execution` event
fires (at the 1.5 min threshold) to give visibility into slow tools.

---

## LogQL Queries

All events documented here live under `job="airo-agents"` in Loki.

### All timing summaries

```logql
{job="airo-agents", env="prod"} |= "stream.timing.summary"
```

### Scope to a specific app

```logql
{job="airo-agents", env="prod"}
  |= "stream.timing.summary"
  |= "\"appId\":\"<app-id>\""
```

### P99 of maxChunkGapMs over a time window

```logql
quantile_over_time(
  0.99,
  {job="airo-agents", env="prod"}
    |= "stream.timing.summary"
    | json
    | unwrap maxChunkGapMs [7d]
)
```

---

## Tuning the Chunk Timeout

1. Collect `maxChunkGapMs` from `stream.timing.summary` across a
   representative prod window (at least 7 days, across all agents and
   models).

2. Compute P99 using the query above.

3. The guard is disabled by default. To enable, set
   `AI_CHUNK_TIMEOUT_MS` to a positive ms value (e.g. `660000` for
   11 min, just past the 10 min stepMS timeout).

4. Update warning thresholds in
   `packages/ai-transport/src/chunk-timeout-guard.ts` to bracket P99 and
   2x P99 so warnings fire before the abort.

5. `DEFAULT_CHUNK_TIMEOUT_MS` is `-1` (disabled). Operators enable
   the guard by setting `AI_CHUNK_TIMEOUT_MS` to a positive ms value.
   The TDD path is established in
   `packages/ai-transport/src/__tests__/chunk-timeout-guard.test.ts`.

The chunk timeout guard is **disabled by default**. When disabled, no
`stream.chunk.gap_warning` or `stream.chunk.timeout.transport` events
fire, and the stepMS timeout is the only stream-level timeout. To
enable, set `AI_CHUNK_TIMEOUT_MS` to a positive ms value. To
explicitly disable, set it to `-1`.
