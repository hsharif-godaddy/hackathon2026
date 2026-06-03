# Chunk-Timeout Soft-Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a stream stalls (GoCode's ~304s trailing idle close), cap the spinner at the chunk-timeout and **commit whatever content already arrived as a completed turn** with a gentle "may be incomplete" advisory — instead of either spinning for 304s or showing a false "connection dropped" error.

**Architecture:** Three independent changes. (C) A client banner guard that hides the red "connection dropped" banner whenever the message already has content. (B) A shared `decideChunkTimeoutFinalization` helper plus a `finish`/`isFinished()` capability on `StreamPartProcessor`, wired into **both** transports so a `chunk_timeout` abort with content present finalizes as a `complete` event carrying a new `finishReason: 'incomplete'` (skipping the dead `getFinalResult()` call), while a `chunk_timeout` with no content fails fast as today. (Client) `finishReason: 'incomplete'` maps to the existing `connectionLost` flag, reusing the existing soft advisory banner. No auto-retry in this cut.

**Tech Stack:** TypeScript, Vitest, `@airo/ai-transport` (shared transport logic), `@airo/agents` (SSE), `@airo/ai-lib` (env override + agent factory), `website` (Next.js client + Zustand store). AI SDK v5 stream parts.

**Why this shape (context for the implementer):**
- The root cause is GoCode-side (holds the HTTP connection ~304s idle after delivering the full response, then closes it → undici `TypeError: terminated`). This ticket is the interim Airo mitigation; we do not wait for GoCode.
- Production evidence (2026-06-03): the AI SDK `finish` frame does **not** arrive before the dead-air gap, so `isFinished()` is almost always `false` for this failure mode. The load-bearing decision is therefore **content-present**, not finish-seen. The `isFinished()` branch is included for correctness (a genuine finish that then stalls → real success) but will rarely fire.
- WebSocket **already** soft-commits chunk_timeout (treats it as an abort → publishes `complete` with `finishReason: 'aborted'` → client `connectionLost`), but it does so regardless of content and tags it `'aborted'`. SSE **hard-errors** the same stall. This plan makes both transports do the same content-gated thing with the same telemetry-distinct `'incomplete'` reason, lifting the decision into shared code (per `packages/ai-transport/CLAUDE.md`).
- Billing: the soft-commit skips `getFinalResult()`, so no usage is captured — the turn is effectively unbilled, identical to today's terminated turn (ticket Q2). No overcharge.

**Decisions locked in (from investigation):**
- New `finishReason: 'incomplete'` (not reuse `'aborted'`) so telemetry can measure how often soft-commit fires and whether users follow up.
- No-content case = fail fast (existing error path). Auto-retry is explicitly deferred.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/ai-transport/src/chunk-timeout-finalization.ts` | **Create** | Pure decision helper `decideChunkTimeoutFinalization` + `ChunkTimeoutOutcome` type. |
| `packages/ai-transport/src/index.ts` | Modify | Export the new helper + type. |
| `packages/ai-transport/src/stream-part-processor.ts` | Modify | Add `finish`/`finish-step` case capturing `finishReason`+`totalUsage`; expose `isFinished()` and `getFinishResult()`. |
| `agents/src/server/sse/MessageExecutionService.ts` | Modify | On `chunk_timeout`: evaluate the decision; soft-commit (skip `getFinalResult`, return `finishReason`) vs fail-fast (throw, existing path). Map soft-commit through the outer finalization. |
| `packages/ai-transport/src/experimental-websocket-server.ts` | Modify | On `chunk_timeout`: content present → `finishReason: 'incomplete'`; no content → fail fast (error terminal). |
| `app/src/stores/useStreamingConversationStore.ts` | Modify | Map `finishReason === 'incomplete'` → `connectionLost`. |
| `app/src/app/[market]/develop/components/StreamingIntegratedResponse.tsx` | Modify | Layer C: gate the `/\bterminated\b/` banner on content present. |

**Test files:** colocated `*.test.ts(x)` next to each module (existing convention).

---

## Task 1: Layer C — client banner guard (independent, ship first)

Gate the red "connection dropped" banner so it never renders on a message that already has delivered content. This is independently shippable and removes the most harmful symptom (the false "type continue" prompt) regardless of the rest of the plan.

**Files:**
- Modify: `app/src/app/[market]/develop/components/StreamingIntegratedResponse.tsx:309`
- Test: `app/src/app/[market]/develop/components/StreamingIntegratedResponse.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe` block that contains `terminatedConnectionDropped` (after the test at line ~376), in `StreamingIntegratedResponse.test.tsx`:

```tsx
    it('suppresses the connection-dropped banner when content already arrived', function terminatedWithContent() {
      renderWithProviders(
        <StreamingIntegratedResponse
          message={upstreamErrorMessage('UPSTREAM_ERROR', {
            error: 'terminated',
            segments: [
              {
                id: 'seg-text-1',
                type: 'text',
                content: 'Here is your answer.',
                timestamp: new Date(),
              },
            ],
          })}
          streamingState="idle"
        />
      );

      // Content renders…
      expect(screen.getByText('Here is your answer.')).toBeInTheDocument();
      // …but the alarming banner does NOT.
      expect(screen.queryByText('builder_connection_dropped_title')).not.toBeInTheDocument();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test StreamingIntegratedResponse -- -t "suppresses the connection-dropped banner when content already arrived"`
Expected: FAIL — `builder_connection_dropped_title` is found in the document (banner currently renders alongside content).

- [ ] **Step 3: Implement the guard**

In `StreamingIntegratedResponse.tsx`, change the terminated branch condition at line 309 from:

```tsx
          ) : /\bterminated\b/i.test(message.error ?? '') ? (
```

to (gate on the already-computed `hasSegments` / `chronologicalContent`):

```tsx
          ) : /\bterminated\b/i.test(message.error ?? '') && !(hasSegments || chronologicalContent.length > 0) ? (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter website test StreamingIntegratedResponse`
Expected: PASS — both the new test and the existing `terminatedConnectionDropped` test (which has no segments) pass.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/[market]/develop/components/StreamingIntegratedResponse.tsx" "app/src/app/[market]/develop/components/StreamingIntegratedResponse.test.tsx"
git commit -m "fix(streaming): suppress connection-dropped banner when content already arrived"
```

---

## Task 2: `finish` capture + `isFinished()` on StreamPartProcessor

Give the shared processor a case for the AI SDK `finish`/`finish-step` parts so it can report whether a terminal frame was seen and surface `finishReason`+`totalUsage`. This is the capability the soft-commit decision keys on.

**Files:**
- Modify: `packages/ai-transport/src/stream-part-processor.ts`
- Test: `packages/ai-transport/src/__tests__/stream-part-processor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ai-transport/src/__tests__/stream-part-processor.test.ts` (create a fresh `describe` block; reuse the file's existing `makeCallbacks()`/processor setup pattern — if the file builds a processor with a `noopCallbacks` object, mirror that):

```ts
describe('finish part capture', () => {
  function noopCallbacks(): PartProcessorCallbacks {
    return {
      onTextDelta: () => {}, onToolStart: () => {}, onToolInputDelta: () => {},
      onToolInputParseFailure: () => {}, onToolCall: () => {}, onToolResult: () => {},
      onToolError: () => {}, onStepStart: () => {}, onError: () => {},
    }
  }

  it('is not finished before any finish part', () => {
    const p = new StreamPartProcessor(noopCallbacks())
    expect(p.isFinished()).toBe(false)
    expect(p.getFinishResult()).toBeUndefined()
  })

  it('captures finishReason and totalUsage from a finish part', () => {
    const p = new StreamPartProcessor(noopCallbacks())
    p.processPart({ type: 'text-delta', text: 'hi' })
    p.processPart({
      type: 'finish',
      finishReason: 'stop',
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    })
    expect(p.isFinished()).toBe(true)
    expect(p.getFinishResult()).toEqual({
      finishReason: 'stop',
      totalUsage: { inputTokens: 10, outputTokens: 5 },
    })
  })

  it('treats finish-step as finished and prefers the last finish frame', () => {
    const p = new StreamPartProcessor(noopCallbacks())
    p.processPart({ type: 'finish-step', finishReason: 'tool-calls' })
    expect(p.isFinished()).toBe(true)
    expect(p.getFinishResult()?.finishReason).toBe('tool-calls')
  })
})
```

Ensure `PartProcessorCallbacks` and `StreamPartProcessor` are imported at the top of the test file (they are already used elsewhere in it).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/ai-transport test stream-part-processor -- -t "finish part capture"`
Expected: FAIL — `p.isFinished is not a function`.

- [ ] **Step 3: Add the finish-result field, case, and accessors**

In `stream-part-processor.ts`, add a private field, a switch case, and two accessor methods.

3a. Add the field next to `stepHasToolCall` (after line 80):

```ts
  private stepHasToolCall = false

  private finishResult: { finishReason: string; totalUsage?: unknown } | undefined
```

3b. Add a case in `processPart`'s `switch`, immediately **before** the `case 'error':` block (before line 175):

```ts
      case 'finish':
      case 'finish-step': {
        // The AI SDK emits this with the terminal finishReason + aggregated
        // usage. We capture it so the chunk-timeout finalization path can tell
        // a genuine completion (frame seen) from a soft-commit (content only).
        // Prefer totalUsage; fall back to usage. No callback — this is internal
        // state, surfaced via isFinished()/getFinishResult().
        const finishReason = (part.finishReason as string | undefined) ?? 'stop'
        const totalUsage = part.totalUsage ?? part.usage
        this.finishResult = {
          finishReason,
          ...(totalUsage !== undefined && { totalUsage }),
        }
        break
      }

```

3c. Add the accessors after `getToolCall` (after line 191):

```ts
  /** True once a terminal `finish`/`finish-step` part has been processed. */
  isFinished(): boolean {
    return this.finishResult !== undefined
  }

  /** The captured finishReason + usage from the terminal frame, or undefined
   * if no `finish`/`finish-step` part has been seen. */
  getFinishResult(): Readonly<{ finishReason: string; totalUsage?: unknown }> | undefined {
    return this.finishResult
  }

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/ai-transport test stream-part-processor`
Expected: PASS — new block passes, existing processor tests unaffected (the `finish` parts previously hit `default: break`, so no behavior changed for non-finish parts).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/stream-part-processor.ts packages/ai-transport/src/__tests__/stream-part-processor.test.ts
git commit -m "feat(ai-transport): capture finish frame in StreamPartProcessor (isFinished/getFinishResult)"
```

---

## Task 3: Shared `decideChunkTimeoutFinalization` helper

A single pure function both transports call, so the soft-commit/fail decision can't drift between SSE and WS.

**Files:**
- Create: `packages/ai-transport/src/chunk-timeout-finalization.ts`
- Modify: `packages/ai-transport/src/index.ts`
- Test: `packages/ai-transport/src/__tests__/chunk-timeout-finalization.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ai-transport/src/__tests__/chunk-timeout-finalization.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decideChunkTimeoutFinalization } from '../chunk-timeout-finalization.js'

describe('decideChunkTimeoutFinalization', () => {
  it('finish frame seen → genuine success (stop)', () => {
    expect(decideChunkTimeoutFinalization({ isFinished: true, hasContent: true }))
      .toEqual({ kind: 'finalize', finishReason: 'stop' })
    // finished but no accumulated text (e.g. tool-only step) still finalizes
    expect(decideChunkTimeoutFinalization({ isFinished: true, hasContent: false }))
      .toEqual({ kind: 'finalize', finishReason: 'stop' })
  })

  it('no finish frame but content present → soft-commit (incomplete)', () => {
    expect(decideChunkTimeoutFinalization({ isFinished: false, hasContent: true }))
      .toEqual({ kind: 'finalize', finishReason: 'incomplete' })
  })

  it('no finish frame and no content → fail fast', () => {
    expect(decideChunkTimeoutFinalization({ isFinished: false, hasContent: false }))
      .toEqual({ kind: 'fail' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/ai-transport test chunk-timeout-finalization`
Expected: FAIL — cannot find module `../chunk-timeout-finalization.js`.

- [ ] **Step 3: Implement the helper**

Create `packages/ai-transport/src/chunk-timeout-finalization.ts`:

```ts
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
 * (`experimental-websocket-server`) so the two transports stay identical. */
export function decideChunkTimeoutFinalization(input: {
  isFinished: boolean
  hasContent: boolean
}): ChunkTimeoutOutcome {
  if (input.isFinished) return { kind: 'finalize', finishReason: 'stop' }
  if (input.hasContent) return { kind: 'finalize', finishReason: 'incomplete' }
  return { kind: 'fail' }
}
```

- [ ] **Step 4: Export from the package index**

In `packages/ai-transport/src/index.ts`, add after line 125 (the `ChunkTimeoutGuard` exports):

```ts
export { decideChunkTimeoutFinalization } from './chunk-timeout-finalization.js'
export type { ChunkTimeoutOutcome } from './chunk-timeout-finalization.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @airo/ai-transport test chunk-timeout-finalization`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ai-transport/src/chunk-timeout-finalization.ts packages/ai-transport/src/index.ts packages/ai-transport/src/__tests__/chunk-timeout-finalization.test.ts
git commit -m "feat(ai-transport): add decideChunkTimeoutFinalization shared helper"
```

---

## Task 4: SSE — soft-commit on chunk_timeout

Make the SSE reader loop stop hard-erroring a stall that already produced content. On `chunk_timeout`: evaluate the shared decision; on `finalize`, break out without throwing, skip the dead `getFinalResult()`, and carry the `finishReason` through to the terminal `complete` event; on `fail`, throw exactly as today.

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts` (reader loop ~1033–1250, finalization ~1252–1326, outer finishReason ~1877–1878)
- Test: `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `MessageExecutionService.test.ts`, alongside the existing chunk-timeout tests (after the test at line ~689). This models the GoCode mode: content streams, then the stream stalls and the guard aborts with `chunk_timeout`.

```ts
    it('soft-commits accumulated content on chunk-timeout (complete:incomplete, no error)', async () => {
      const previous = process.env.AI_CHUNK_TIMEOUT_MS
      try {
        process.env.AI_CHUNK_TIMEOUT_MS = '5'
        deps = createMockDeps()
        deps.getAgent.mockReturnValue({
          streamGenerate: vi.fn().mockImplementation(function (_m: string, opts: { abortSignal: AbortSignal }) {
            return {
              textStream: (async function* () {})(),
              baseStream: new ReadableStream({
                start(controller) {
                  // Deliver content, then go silent so the guard fires.
                  controller.enqueue({ part: { type: 'text-delta', text: 'partial answer' } })
                  opts.abortSignal.addEventListener('abort', () => {
                    controller.error(new Error(String(opts.abortSignal.reason ?? 'aborted')))
                  }, { once: true })
                },
              }),
              // Backed by the dead socket — never resolves; must NOT be awaited.
              getFinalResult: vi.fn().mockImplementation(() => new Promise(() => {})),
            }
          }),
          getName: vi.fn().mockReturnValue('AI Developer'),
        })
        service = new MessageExecutionService(deps as any)

        await service.execute(DEFAULT_PARAMS)

        expect(deps.eventChannel.publish).not.toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({ type: 'error' }),
        )
        expect(deps.eventChannel.publish).toHaveBeenCalledWith(
          'conv_1',
          expect.objectContaining({
            type: 'complete',
            data: expect.objectContaining({ finishReason: 'incomplete' }),
          }),
        )
      } finally {
        if (previous === undefined) delete process.env.AI_CHUNK_TIMEOUT_MS
        else process.env.AI_CHUNK_TIMEOUT_MS = previous
      }
    })
```

Note: the existing test at line 644 (`aborts stalled streams on chunk-timeout and emits terminal error + complete`) streams **no** content, so it remains the fail-fast case and must still pass unchanged.

- [ ] **Step 2: Run test to verify it fails (and hangs/errors)**

Run: `pnpm --filter @airo/agents test:unit MessageExecutionService -- -t "soft-commits accumulated content on chunk-timeout"`
Expected: FAIL — currently `throwChunkTimeoutError()` fires regardless of content, so an `error` event is published (and/or the test trips because `getFinalResult` would be awaited). Confirms the gap.

- [ ] **Step 3: Add imports**

In `MessageExecutionService.ts`, extend the existing `@airo/ai-transport` import to include the helper. Find the import that already pulls `ChunkTimeoutGuard` (line 5 region) and add `decideChunkTimeoutFinalization`:

```ts
import {
  ChunkTimeoutGuard,
  decideChunkTimeoutFinalization,
  // …existing members…
} from '@airo/ai-transport'
```

(If `ChunkTimeoutGuard` is imported on its own line, add a sibling import line for `decideChunkTimeoutFinalization` from `'@airo/ai-transport'`.)

- [ ] **Step 4: Replace the always-throw with a content-gated decision**

Replace the `throwChunkTimeoutError` declaration at lines 1033–1035:

```ts
    const throwChunkTimeoutError = (): never => {
      throw new Error(`Stream chunk timeout after ${this.chunkTimeoutMs!}ms`)
    }
```

with a declaration of both the thrower and a soft-commit-aware handler plus a mutable carry variable:

```ts
    const throwChunkTimeoutError = (): never => {
      throw new Error(`Stream chunk timeout after ${this.chunkTimeoutMs!}ms`)
    }

    // Set by handleChunkTimeout() when the stall is soft-committable (content
    // already arrived, or a terminal finish frame was seen). Non-null signals
    // the finalization block below to SKIP getFinalResult() — which is backed
    // by the now-dead socket and would never resolve — and finalize the turn
    // with this finishReason instead.
    let chunkTimeoutFinishReason: 'stop' | 'incomplete' | null = null

    // Returns true if the caller should break the reader loop (soft-commit);
    // throws (never returns) on the fail-fast path, preserving today's behaviour.
    const handleChunkTimeout = (): boolean => {
      const outcome = decideChunkTimeoutFinalization({
        isFinished: processor.isFinished(),
        hasContent: processor.getState().accumulatedContent.length > 0,
      })
      if (outcome.kind === 'fail') throwChunkTimeoutError()
      chunkTimeoutFinishReason = outcome.finishReason
      logger.warn('sse.stream.chunk_timeout.soft_commit', {
        appId, conversationId, agentName, finishReason: outcome.finishReason,
      })
      return true
    }
```

- [ ] **Step 5: Route the four chunk_timeout sites through the handler**

Update each of the four sites. The pattern: where it currently calls `throwChunkTimeoutError()`, call `handleChunkTimeout()` and `break` the reader loop when it returns (soft-commit). The `fail` path still throws inside `handleChunkTimeout`, so the `break` is only reached on soft-commit.

5a. Lines 1185–1188 (top-of-loop abort check) — change:

```ts
            if (abortSignal.aborted) {
              if (abortSignal.reason === 'chunk_timeout') throwChunkTimeoutError()
              break
            }
```

to:

```ts
            if (abortSignal.aborted) {
              if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout(); break }
              break
            }
```

5b. Lines 1192–1193 (catch of `reader.read()`) — change:

```ts
            } catch (readError) {
              if (abortSignal.reason === 'chunk_timeout') throwChunkTimeoutError()
```

to:

```ts
            } catch (readError) {
              if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout(); break }
```

5c. Lines 1235–1238 (top of textStream-only loop) — change:

```ts
            if (abortSignal.aborted) {
              if (abortSignal.reason === 'chunk_timeout') throwChunkTimeoutError()
              break
            }
```

to:

```ts
            if (abortSignal.aborted) {
              if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout(); break }
              break
            }
```

5d. Lines 1244–1246 (catch of textStream loop) — change:

```ts
        } catch (textStreamError) {
          if (abortSignal.reason === 'chunk_timeout') throwChunkTimeoutError()
          throw textStreamError
```

to:

```ts
        } catch (textStreamError) {
          if (abortSignal.reason === 'chunk_timeout') { handleChunkTimeout(); /* fall through to finally, then skip getFinalResult */ }
          else throw textStreamError
```

> Note for 5d: on soft-commit we must not re-throw. The `finally` (line 1247–1249) still runs `flushPendingWork()`. Because this `catch` is the textStream-only branch (no `break` target — it is not inside the `while`), execution continues past the `try/catch/finally` to the finalization block, where `chunkTimeoutFinishReason` is now set.

- [ ] **Step 6: Skip getFinalResult on soft-commit in the finalization block**

Replace the finalization block at lines 1256–1274:

```ts
      let finishReason = 'complete'
      let finalResult: any
      let finalResultError: unknown
      try {
        finalResult = await streamResult.getFinalResult()
        finishReason = finalResult?.finishReason ?? 'complete'
      } catch (err) {
        // …existing comment…
        logger.warn('sse.execution.getFinalResult.failed', { appId, conversationId, ...errorFields(err) })
        finalResultError = err
        finishReason = 'result_fetch_failed'
      }
```

with:

```ts
      let finishReason = 'complete'
      let finalResult: any
      let finalResultError: unknown
      if (chunkTimeoutFinishReason !== null) {
        // Soft-commit: the socket is dead, so getFinalResult() would block on
        // promises that never settle. Finalize from the captured finish frame
        // (if any) instead. No usage is captured on the 'incomplete' path —
        // the turn is effectively unbilled, matching today's terminated turn.
        finishReason = chunkTimeoutFinishReason
        const captured = processor.getFinishResult()
        finalResult = captured ? { finishReason: captured.finishReason, totalUsage: captured.totalUsage } : { finishReason }
      } else {
        try {
          finalResult = await streamResult.getFinalResult()
          finishReason = finalResult?.finishReason ?? 'complete'
        } catch (err) {
          // Preserve the legacy warn log + continue returning a result to the
          // caller, but do NOT let this fall through to invocation.endSuccess()
          // below — without usage and with no final result, the span would
          // misleadingly show a successful turn in Langfuse. Capture the error
          // and mark finishReason so the branch below ends the span as a
          // failure via invocation.endError. WS doesn't wrap getFinalResult at
          // all (its outer catch handles it); SSE keeps the wrap for callers
          // that inspect finishReason but surfaces the failure to telemetry.
          logger.warn('sse.execution.getFinalResult.failed', { appId, conversationId, ...errorFields(err) })
          finalResultError = err
          finishReason = 'result_fetch_failed'
        }
      }
```

> The existing `invocation.endAborted` branch at line 1290 (`if (abortSignal.aborted)`) still fires for soft-commit (the controller IS aborted) — the Langfuse span is honestly marked aborted, while the wire-facing `finishReason` is carried via the returned value. No change needed there. The method then returns normally at line 1319 with `finishReason` set, so the outer flow takes the success path.

- [ ] **Step 7: Map soft-commit through the outer finishReason**

At line 1877–1878 the outer flow currently forces `'aborted'` whenever the controller aborted. Make a chunk_timeout soft-commit win over that. Replace:

```ts
      const loopAborted = loopResult.termination === 'aborted' || abortController.signal.aborted
      const finishReason = loopAborted ? 'aborted' : (lastTurnResult?.finishReason ?? 'complete')
```

with:

```ts
      // A chunk_timeout soft-commit aborts the controller but is NOT a turn
      // abort: it produced content (or saw a finish frame) and should finalize
      // as a normal completion carrying its own finishReason ('incomplete' or
      // 'stop'), not 'aborted'. Keep end-hooks/budget on the non-aborted path.
      const chunkTimeoutSoftCommit =
        abortController.signal.reason === 'chunk_timeout'
        && (lastTurnResult?.finishReason === 'incomplete' || lastTurnResult?.finishReason === 'stop')
      const loopAborted =
        (loopResult.termination === 'aborted' || abortController.signal.aborted)
        && !chunkTimeoutSoftCommit
      const finishReason = loopAborted ? 'aborted' : (lastTurnResult?.finishReason ?? 'complete')
```

- [ ] **Step 8: Run the SSE chunk-timeout tests**

Run: `pnpm --filter @airo/agents test:unit MessageExecutionService -- -t "chunk-timeout"`
Expected: PASS — the new soft-commit test passes; the existing no-content test (line 644) still emits `error` + `complete:error`; the "does not count connection time" test still emits `complete:complete`.

- [ ] **Step 9: Run the full SSE suite to check for regressions**

Run: `pnpm --filter @airo/agents test:unit MessageExecutionService`
Expected: PASS — no regressions in the broader finalization/abort tests.

- [ ] **Step 10: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/MessageExecutionService.test.ts
git commit -m "feat(agents): soft-commit accumulated content on SSE chunk-timeout"
```

---

## Task 5: WebSocket — content-gated chunk_timeout finalization

WS already finalizes chunk_timeout as an abort (`complete` with `finishReason: 'aborted'`), but it does so regardless of content and tags it `'aborted'`. Align it: content present (or finish seen) → `finishReason: 'incomplete'`; no content → fail fast as an error terminal. Use the same shared helper.

**Files:**
- Modify: `packages/ai-transport/src/experimental-websocket-server.ts` (finishReason computation ~2377–2380; abort short-circuit ~3497–3520; post-stream abort catch ~3799–3813)
- Test: `packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts`

- [ ] **Step 1: Read the WS finalization seams before editing**

Re-read these regions so the edits land in the right place (line numbers drift):
- `experimental-websocket-server.ts:2372–2382` — `handleChatMessageInternal` computes `finishReason` for the post-`streamAgentResponse` `complete` publish.
- `:3495–3521` — `streamAgentResponse` abort short-circuit (`stream.aborted.skip_get_final_result`).
- `:3794–3813` — `streamAgentResponse` `postStreamError` catch, abort branch.

The accumulated content for a socket is `this.getConversation(socketId)?.accumulatedContent`. The processor instance lives in `streamWithRealTimeToolCalls`/`processStreamWithToolEvents`; for the WS finalization seam, gate on `accumulatedContent` (the conversation's running buffer) since that is what is in scope at 2377. Treating "finish frame seen" is optional here because WS computes finishReason outside the processor scope — gate on content only, which matches the GoCode mode (no finish frame anyway).

- [ ] **Step 2: Write the failing tests**

Add to `packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts`. Two cases: chunk_timeout with content → `complete:incomplete`, no `error`; chunk_timeout with no content → `error` terminal. Use the file's existing WS server harness (look for how other tests construct the server, a fake socket, and assert on `publishToEventChannel`/the event channel spy; mirror that exact setup — do not invent a new harness).

```ts
describe('chunk_timeout finalization', () => {
  // Mirror the existing WS test harness in this file: construct the server with
  // chunkTimeoutMs set, a fake socket, a streamResult whose baseStream emits the
  // given content then stalls until abort('chunk_timeout'), and a spy on the
  // event channel. See the neighbouring describe blocks for the canonical setup.

  it('soft-commits with finishReason "incomplete" when content arrived', async () => {
    // GIVEN a stream that emits a text-delta then stalls
    // WHEN the chunk-timeout guard aborts with reason 'chunk_timeout'
    // THEN a 'complete' event is published with finishReason 'incomplete'
    //      AND no 'error' event is published
    // (assertions modelled on the SSE test in Task 4)
  })

  it('fails fast with an error terminal when no content arrived', async () => {
    // GIVEN a stream that emits nothing then stalls
    // WHEN the chunk-timeout guard aborts with reason 'chunk_timeout'
    // THEN an 'error' event is published (no false 'complete:incomplete')
  })
})
```

> Implementer: flesh out the two cases against the concrete harness already in this file (it has working chunk-timeout/guard tests around `createChunkTimeoutGuard` at line ~3977 and stream tests earlier). Keep the assertions identical in spirit to the SSE Task 4 test.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @airo/ai-transport test experimental-websocket-server -- -t "chunk_timeout finalization"`
Expected: FAIL — content case currently yields `finishReason: 'aborted'` (not `'incomplete'`); no-content case currently also soft-commits (no `error`).

- [ ] **Step 4: Import the helper**

At the top of `experimental-websocket-server.ts`, the file already imports `ChunkTimeoutGuard` from `'./chunk-timeout-guard.js'` (line 52). Add:

```ts
import { decideChunkTimeoutFinalization } from './chunk-timeout-finalization.js'
```

- [ ] **Step 5: Gate the finishReason on content (chunk_timeout → incomplete)**

In `handleChatMessageInternal`, replace the finishReason computation at lines 2378–2380:

```ts
      const finishReason = abortSignal.aborted
        ? (completionStateData?.userStopped ? 'user_stopped' : 'aborted')
        : undefined
```

with:

```ts
      const chunkTimeoutAbort = abortSignal.aborted && abortSignal.reason === 'chunk_timeout'
      const chunkTimeoutContent = this.getConversation(socketId)?.accumulatedContent ?? ''
      const chunkTimeoutOutcome = chunkTimeoutAbort
        ? decideChunkTimeoutFinalization({ isFinished: false, hasContent: chunkTimeoutContent.length > 0 })
        : undefined
      const finishReason = chunkTimeoutOutcome?.kind === 'finalize'
        ? chunkTimeoutOutcome.finishReason
        : abortSignal.aborted
          ? (completionStateData?.userStopped ? 'user_stopped' : 'aborted')
          : undefined
```

> This yields `'incomplete'` for chunk_timeout-with-content, leaves user-stop and other aborts as `'aborted'`/`'user_stopped'`, and produces `undefined` (→ normal completion) only on the non-abort path. The no-content chunk_timeout produces `chunkTimeoutOutcome.kind === 'fail'`, so it falls through to `'aborted'` here — Step 6 turns that into a hard error instead.

- [ ] **Step 6: Fail fast (error terminal) on no-content chunk_timeout**

In the `streamAgentResponse` `postStreamError` catch, the abort branch at lines 3799–3813 currently returns for ALL aborts (letting the caller publish `complete`). Add a no-content chunk_timeout carve-out so it re-throws into the normal error path instead. Replace lines 3799–3813:

```ts
      if (abortSignal?.aborted) {
        invocation.endError(postStreamError)
        this.logger.info('stream.aborted', {
          socketId: socket.id,
          agentName,
          step: currentStep,
        })

        // Don't publish complete:aborted here — the handoff loop abort check
        // in handleChatMessageInternal always publishes it after streamAgentResponse
        // returns (covering both throw and clean-return paths). Publishing here
        // would create a duplicate with inconsistent totalSteps.
        // Return any steps captured before abort for cost attribution
        return { steps: executionSteps }
      }
```

with:

```ts
      if (abortSignal?.aborted) {
        // No-content chunk_timeout is NOT soft-committable: there is nothing to
        // commit, so fail fast onto the normal error path (error terminal +
        // classifyTurnError) instead of finalizing as a (false) completion.
        const isChunkTimeout = abortSignal.reason === 'chunk_timeout'
        const hasContent = (this.getConversation(socket.id)?.accumulatedContent ?? '').length > 0
        if (isChunkTimeout && !hasContent) {
          this.logger.warn('stream.chunk_timeout.fail_fast', { socketId: socket.id, agentName, step: currentStep })
          invocation.endError(postStreamError)
          throw postStreamError
        }

        invocation.endError(postStreamError)
        this.logger.info('stream.aborted', {
          socketId: socket.id,
          agentName,
          step: currentStep,
        })

        // Don't publish complete:aborted here — the handoff loop abort check
        // in handleChatMessageInternal always publishes it after streamAgentResponse
        // returns (covering both throw and clean-return paths). Publishing here
        // would create a duplicate with inconsistent totalSteps.
        // Return any steps captured before abort for cost attribution
        return { steps: executionSteps }
      }
```

> The same no-content carve-out is not needed at the `:3497` clean-return short-circuit: that path is only reached when the reader loop broke on the top-of-loop abort check having read content already (or nothing). If a WS regression test shows a no-content stall reaching `:3497`, add the identical `isChunkTimeout && !hasContent` guard there to throw a chunk-timeout error. Verify via the Step 3 no-content test.

- [ ] **Step 7: Run the WS chunk-timeout tests**

Run: `pnpm --filter @airo/ai-transport test experimental-websocket-server -- -t "chunk_timeout finalization"`
Expected: PASS — content → `complete:incomplete` (no error); no content → `error` terminal.

- [ ] **Step 8: Run the full WS suite to check for regressions**

Run: `pnpm --filter @airo/ai-transport test experimental-websocket-server`
Expected: PASS — user-stop (`user_stopped`), disconnect (`aborted`), and normal completion paths unchanged.

- [ ] **Step 9: Commit**

```bash
git add packages/ai-transport/src/experimental-websocket-server.ts packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts
git commit -m "feat(ai-transport): content-gated chunk-timeout finalization for WebSocket"
```

---

## Task 6: Client — map `finishReason: 'incomplete'` to the soft advisory

The client already shows a calm "response may be incomplete — send a follow-up" banner for `connectionLost` (driven by `finishReason` `'aborted'`/`'server_shutdown'`). Extend that derivation to include the new `'incomplete'` reason so the soft-commit renders as a completed message with the soft advisory — not the red error.

**Files:**
- Modify: `app/src/stores/useStreamingConversationStore.ts:1184`
- Test: `app/src/stores/useStreamingConversationStore.test.ts`

- [ ] **Step 1: Write the failing test**

In `app/src/stores/useStreamingConversationStore.test.ts`, alongside the existing `connectionLost` tests (near line 824), add:

```ts
    it('should set connectionLost when finishReason is incomplete', function connectionLostIncomplete() {
      // Mirror the existing 'should set connectionLost when finishReason is aborted'
      // test's setup (start a stream, then finalize with the given finishReason)
      // and assert connectionLost is true for finishReason 'incomplete'.
    });
```

> Implementer: copy the body of the adjacent `'should set connectionLost when finishReason is aborted'` test verbatim and change the finalize `finishReason` to `'incomplete'` and the assertion target message; the harness is identical.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter website test useStreamingConversationStore -- -t "connectionLost when finishReason is incomplete"`
Expected: FAIL — `connectionLost` is `undefined` for `'incomplete'`.

- [ ] **Step 3: Implement the mapping**

In `useStreamingConversationStore.ts`, change line 1184:

```ts
    const connectionLost = metadata?.finishReason === 'aborted' || metadata?.finishReason === 'server_shutdown'
```

to:

```ts
    // 'incomplete' = server soft-committed a chunk-timeout stall: content
    // arrived but no terminal frame. Reuse the connectionLost advisory
    // ("response may be incomplete — send a follow-up"), not the red error.
    const connectionLost = metadata?.finishReason === 'aborted'
      || metadata?.finishReason === 'server_shutdown'
      || metadata?.finishReason === 'incomplete'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter website test useStreamingConversationStore`
Expected: PASS — new test passes; existing `aborted`/`server_shutdown`/negative tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add app/src/stores/useStreamingConversationStore.ts app/src/stores/useStreamingConversationStore.test.ts
git commit -m "feat(streaming-store): map finishReason 'incomplete' to connectionLost advisory"
```

---

## Task 7: Cross-package verification

Confirm types, lints, and builds across every package this plan touched, and run the affected test suites together.

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the touched packages**

Run:
```bash
pnpm --filter @airo/ai-transport typecheck
pnpm --filter @airo/agents typecheck
pnpm --filter @airo/ai-lib typecheck
pnpm --filter website typecheck
```
Expected: all pass. (The `'incomplete' | 'stop'` literal types on `ChunkTimeoutOutcome` must line up with the `chunkTimeoutFinishReason` carry variable in SSE — fix any literal-widening errors here.)

- [ ] **Step 2: Lint the touched packages**

Run:
```bash
pnpm --filter @airo/ai-transport lint
pnpm --filter @airo/agents lint
pnpm --filter website lint
```
Expected: pass. Prefer `const`/explicit types per the repo guidelines; the one `let chunkTimeoutFinishReason` in SSE is a legitimate tactical accumulator (assigned from inside the reader loop), which the guidelines explicitly permit.

- [ ] **Step 3: Build the shared package consumers**

Run:
```bash
pnpm --filter @airo/ai-transport build
pnpm --filter @airo/agents build
```
Expected: pass — `@airo/agents` picks up the new `decideChunkTimeoutFinalization` export from the built `@airo/ai-transport`.

- [ ] **Step 4: Run the affected test suites**

Run:
```bash
pnpm --filter @airo/ai-transport test
pnpm --filter @airo/agents test:unit MessageExecutionService
pnpm --filter website test StreamingIntegratedResponse
pnpm --filter website test useStreamingConversationStore
```
Expected: all pass.

- [ ] **Step 5: Final commit (if any lint/type fixups were made)**

```bash
git add -A
git commit -m "chore: typecheck/lint fixups for chunk-timeout soft-commit"
```

---

## Rollout notes (not code steps)

- **Flag:** Layer B (Tasks 2–6) is gated by the `AI_CHUNK_TIMEOUT_MS` env var (`parseChunkTimeoutMs()` → guard is `null` when unset). The code change is inert in production until that var is set to a positive ms value (~60000–90000). Land the code dark, then enable per-environment.
- **Layer C (Task 1)** is independent of the flag and ships immediately.
- **Telemetry:** after enabling, watch for `sse.stream.chunk_timeout.soft_commit` / `stream.chunk_timeout.fail_fast` and the rate of `finishReason: 'incomplete'` terminal events to measure how often soft-commit fires and whether users send a follow-up.

## Acceptance-criteria mapping

| Ticket AC | Task(s) |
| --- | --- |
| Banner never renders on a message with content | Task 1 |
| Stalled turn resolves at ~timeout, not ~304s (finalize or fail) | Tasks 4, 5 (skip `getFinalResult` on soft-commit; fail-fast on no content) |
| Never commit partial as success **without a signal** | Satisfied by the *product decision*: partial-with-content commits as `'incomplete'` (a distinct, non-success advisory state), no content → fail. Note this AC's original wording is superseded by the agreed soft-commit decision. |
| No regression to incremental save-on-error persistence | Unchanged — persistence subscriber `onError` no-op + incremental saves untouched; verified by Task 4/5 suites |
| Identical across SSE and WebSocket | Tasks 3–5 (shared `decideChunkTimeoutFinalization`) |
| Unit tests cover completed-then-stalled + stalled-no-content | Tasks 4 (SSE), 5 (WS) |
