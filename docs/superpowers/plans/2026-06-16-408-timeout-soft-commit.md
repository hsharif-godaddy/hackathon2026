# 408 Upstream-Timeout Soft-Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop GoCode's ~304s HTTP 408 "request timeout" from showing a raw red error in chat; preserve already-streamed partial content and show a friendly message otherwise — by extending the existing AIROBUILD-2079 soft-commit seam to the 408/504 HTTP-response flavor.

**Architecture:** Add one shared predicate `isUpstreamTimeoutError()` (statusCode 408/504) in `@airo/ai-transport`, then broaden the existing soft-commit gate in both transports (SSE `MessageExecutionService.handlePrematureClose`, WS `experimental-websocket-server` postStreamError catch) and add a friendly `clientMessage` in `classifyTurnError` for the no-content fail-fast path. Content-present timeouts finalize as `finishReason:'incomplete'` (existing client `connectionLost` advisory, no client/i18n change). Ships ungated.

**Tech Stack:** TypeScript, Vitest, AI SDK (`ai` package `APICallError`), pnpm workspaces, Turborepo.

**Spec:** `docs/superpowers/specs/2026-06-16-408-timeout-soft-commit-design.md`

---

## File Structure

- `packages/ai-transport/src/analyze-stream-error.ts` — add `isUpstreamTimeoutError()` predicate (beside `isNetworkError`).
- `packages/ai-transport/src/index.ts` — export the new predicate.
- `packages/ai-transport/src/classify-turn-error.ts` — friendly `clientMessage` for 408/504.
- `agents/src/server/sse/MessageExecutionService.ts` — broaden `handlePrematureClose` gate + log fields.
- `packages/ai-transport/src/experimental-websocket-server.ts` — broaden postStreamError soft-commit gate + log fields.
- Tests live next to each module (`__tests__/`), per `packages/ai-transport/CLAUDE.md`.

---

## Task 1: `isUpstreamTimeoutError()` predicate

**Files:**
- Modify: `packages/ai-transport/src/analyze-stream-error.ts` (add after `isNetworkError`, ~line 45)
- Modify: `packages/ai-transport/src/index.ts:180`
- Test: `packages/ai-transport/src/__tests__/analyze-stream-error.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ai-transport/src/__tests__/analyze-stream-error.test.ts`, update the import on line 2 and add a new describe block at the end of the file:

```typescript
// line 2 — add isUpstreamTimeoutError to the existing import
import { analyzeStreamError, isNetworkError, isUpstreamTimeoutError } from '../analyze-stream-error.js'
```

```typescript
describe('isUpstreamTimeoutError', () => {
  it('returns false for null/undefined', () => {
    expect(isUpstreamTimeoutError(null)).toBe(false)
    expect(isUpstreamTimeoutError(undefined)).toBe(false)
  })

  it('returns true for statusCode 408 (GoCode request timeout)', () => {
    expect(isUpstreamTimeoutError(Object.assign(new Error('request timeout'), { statusCode: 408 }))).toBe(true)
  })

  it('returns true for statusCode 504 (gateway timeout)', () => {
    expect(isUpstreamTimeoutError(Object.assign(new Error('gateway timeout'), { statusCode: 504 }))).toBe(true)
  })

  it('returns false for other status codes', () => {
    expect(isUpstreamTimeoutError(Object.assign(new Error('x'), { statusCode: 400 }))).toBe(false)
    expect(isUpstreamTimeoutError(Object.assign(new Error('x'), { statusCode: 429 }))).toBe(false)
    expect(isUpstreamTimeoutError(Object.assign(new Error('x'), { statusCode: 500 }))).toBe(false)
  })

  it('returns false for a network error with no statusCode', () => {
    expect(isUpstreamTimeoutError(new TypeError('terminated'))).toBe(false)
  })

  it('returns false for a non-error value', () => {
    expect(isUpstreamTimeoutError('just a string')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/ai-transport test analyze-stream-error`
Expected: FAIL — `isUpstreamTimeoutError is not a function` (or import/type error).

- [ ] **Step 3: Write minimal implementation**

In `packages/ai-transport/src/analyze-stream-error.ts`, add after line 45 (after the `isNetworkError` function, before `analyzeStreamError`):

```typescript
/** HTTP status codes the upstream model proxy (GoCode) returns when it
 * enforces its own ~304s request timeout: 408 (request timeout) and 504
 * (gateway timeout). Distinct from `isNetworkError` — these arrive as a real
 * HTTP response (`isNetworkError: false`), e.g. AI-SDK `APICallError`. */
const UPSTREAM_TIMEOUT_STATUS_CODES = new Set([408, 504])

/** True when `error` carries an HTTP status code indicating the upstream
 * proxy timed the request out. Used to route these through the same
 * content-gated soft-commit seam as network-level premature closes, instead
 * of surfacing a raw "Request Timeout" error to the user. */
export function isUpstreamTimeoutError(error: unknown): boolean {
  if (!error) return false
  const statusCode = (error as { statusCode?: number })?.statusCode
  return statusCode !== undefined && UPSTREAM_TIMEOUT_STATUS_CODES.has(statusCode)
}
```

In `packages/ai-transport/src/index.ts`, update line 180:

```typescript
export { analyzeStreamError, isNetworkError, isUpstreamTimeoutError } from './analyze-stream-error.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/ai-transport test analyze-stream-error`
Expected: PASS (all `isUpstreamTimeoutError` cases + existing `isNetworkError`/`analyzeStreamError` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/analyze-stream-error.ts packages/ai-transport/src/index.ts packages/ai-transport/src/__tests__/analyze-stream-error.test.ts
git commit -m "feat(ai-transport): add isUpstreamTimeoutError predicate (408/504)"
```

---

## Task 2: Friendly client message for 408/504 in `classifyTurnError`

**Files:**
- Modify: `packages/ai-transport/src/classify-turn-error.ts:1-4,77-83`
- Test: `packages/ai-transport/src/__tests__/classify-turn-error.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ai-transport/src/__tests__/classify-turn-error.test.ts`, add after the existing `'classifies APICallError: 400 is not retryable'` test (~line 66):

```typescript
  it('classifies APICallError: 408 is not retryable but carries a friendly timeout message', () => {
    const err = new APICallError({ message: 'Request Timeout', url: 'https://x', requestBodyValues: {}, statusCode: 408 })
    expect(classifyTurnError(err)).toEqual({
      statusCode: 408,
      isRetryable: false,
      clientMessage: 'The AI took too long to respond and the request timed out. Please send your message again.',
    })
  })

  it('classifies APICallError: 504 carries the friendly timeout message', () => {
    const err = new APICallError({ message: 'Gateway Timeout', url: 'https://x', requestBodyValues: {}, statusCode: 504 })
    expect(classifyTurnError(err)).toEqual({
      statusCode: 504,
      isRetryable: false,
      clientMessage: 'The AI took too long to respond and the request timed out. Please send your message again.',
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/ai-transport test classify-turn-error`
Expected: FAIL — the 408/504 results lack `clientMessage`.

- [ ] **Step 3: Write minimal implementation**

In `packages/ai-transport/src/classify-turn-error.ts`, add the import after line 4:

```typescript
import { isUpstreamTimeoutError } from './analyze-stream-error.js'
```

Replace the `APICallError` branch (lines 77-83):

```typescript
  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode
    return {
      ...(statusCode !== undefined && { statusCode }),
      isRetryable: statusCode === 503 || statusCode === 429,
      ...(isUpstreamTimeoutError(error) && {
        clientMessage: 'The AI took too long to respond and the request timed out. Please send your message again.',
      }),
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/ai-transport test classify-turn-error`
Expected: PASS. The existing 400/429/503 tests stay green (none are 408/504, so no `clientMessage` added).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/classify-turn-error.ts packages/ai-transport/src/__tests__/classify-turn-error.test.ts
git commit -m "feat(ai-transport): friendly clientMessage for 408/504 upstream timeouts"
```

---

## Task 3: Broaden SSE soft-commit gate (`MessageExecutionService`)

**Files:**
- Modify: `agents/src/server/sse/MessageExecutionService.ts:19-30` (import), `:1126-1141` (`handlePrematureClose`)
- Test: `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`

- [ ] **Step 1: Write the failing tests**

In `agents/src/server/sse/__tests__/MessageExecutionService.test.ts`, inside the same `describe` block that holds the premature-close tests (after the `makeTerminatedError` helper, ~line 926), add a 408 helper and two tests:

```typescript
    // GoCode's ~304s request-timeout HTTP response: a real APICallError-shaped
    // error (isNetworkError:false) carrying statusCode 408. isUpstreamTimeoutError matches it.
    const make408Error = (): Error =>
      Object.assign(new Error('request timeout'), { statusCode: 408, responseBody: 'request timeout' })

    it('soft-commits accumulated content on a 408 upstream timeout (complete:incomplete, getFinalResult skipped)', async () => {
      deps = createMockDeps()
      const getFinalResult = vi.fn().mockImplementation(() => new Promise(() => {}))
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockReturnValue({
          textStream: (async function* () {
            yield 'partial answer'
            throw make408Error()
          })(),
          getFinalResult,
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
      expect(getFinalResult).not.toHaveBeenCalled()
      expect(mockInvocationEnd).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, finishReason: 'incomplete' }),
      )
    })

    it('fails fast (error terminal) on a 408 upstream timeout with no content', async () => {
      deps = createMockDeps()
      deps.getAgent.mockReturnValue({
        streamGenerate: vi.fn().mockReturnValue({
          // eslint-disable-next-line require-yield
          textStream: (async function* () {
            throw make408Error()
          })(),
          getFinalResult: vi.fn(),
        }),
        getName: vi.fn().mockReturnValue('AI Developer'),
      })
      service = new MessageExecutionService(deps as any)

      await service.execute(DEFAULT_PARAMS)

      expect(deps.eventChannel.publish).toHaveBeenCalledWith(
        'conv_1',
        expect.objectContaining({ type: 'error' }),
      )
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/agents test:unit MessageExecutionService -t "408 upstream timeout"`
Expected: the content-present test FAILS (currently publishes `type:'error'` / no `incomplete` complete, because the 408 misses the `isNetworkError`-only gate). The no-content test may already pass (it already hard-errors).

- [ ] **Step 3: Write the implementation**

In `agents/src/server/sse/MessageExecutionService.ts`, add `isUpstreamTimeoutError` to the import block (lines 19-30), after `isNetworkError,`:

```typescript
  isNetworkError,
  isUpstreamTimeoutError,
```

Replace the body of `handlePrematureClose` (lines 1128-1141) — change the guard and enrich the log:

```typescript
    const handlePrematureClose = (err: unknown): boolean => {
      const upstreamTimeout = isUpstreamTimeoutError(err)
      if (!isNetworkError(err) && !upstreamTimeout) return false
      const outcome = decideChunkTimeoutFinalization({
        isFinished: processor.isFinished(),
        hasContent: processor.getAccumulatedContent().length > 0,
      })
      if (outcome.kind !== 'finalize') return false
      chunkTimeoutFinishReason = outcome.finishReason
      prematureCloseError = err
      logger.warn('sse.stream.premature_close.soft_commit', {
        appId, conversationId, agentName, finishReason: outcome.finishReason,
        trigger: upstreamTimeout ? 'upstream_timeout' : 'network_close',
        statusCode: analyzeStreamError(err).statusCode,
        ...errorFields(err),
      })
      return true
    }
```

Also update the block comment above (lines 1120-1127) to mention the 408/504 HTTP-response case — replace the first sentence so it reads:

```typescript
    // On a premature upstream close (undici `terminated`, socket reset, body
    // timeout — anything isNetworkError matches) OR an upstream request-timeout
    // HTTP response (GoCode 408 / gateway 504 — isUpstreamTimeoutError matches)
    // where content already arrived, soft-commit it via the same seam as
    // chunk_timeout instead of surfacing a hard error. Returns true if
    // soft-committed (caller stops reading); false → caller rethrows.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit MessageExecutionService -t "408 upstream timeout"`
Expected: PASS — content present → `complete:incomplete`, no error, `getFinalResult` skipped, honest error span; no content → `type:'error'`.

- [ ] **Step 5: Run the full SSE soft-commit suite for regressions**

Run: `pnpm --filter @airo/agents test:unit MessageExecutionService -t "premature close"`
Expected: PASS — existing `terminated` soft-commit tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts agents/src/server/sse/__tests__/MessageExecutionService.test.ts
git commit -m "feat(agents): soft-commit 408/504 upstream timeouts in SSE transport"
```

---

## Task 4: Broaden WS soft-commit gate (`experimental-websocket-server`)

**Files:**
- Modify: `packages/ai-transport/src/experimental-websocket-server.ts:46` (import), `:4030-4045` (postStreamError soft-commit)
- Test: `packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts`, inside the `describe('premature close (network) finalization', ...)` block (after the `'no content → error terminal'` test, ~line 4770), add a 408 helper + content-present test mirroring the terminated one:

```typescript
  // GoCode ~304s request-timeout HTTP response — isUpstreamTimeoutError matches (statusCode 408).
  const make408Error = (): Error =>
    Object.assign(new Error('request timeout'), { statusCode: 408, responseBody: 'request timeout' })

  it('408 upstream timeout with content → complete with finishReason incomplete, no error, getFinalResult skipped', async () => {
    const mockPersistence = createMockPersistence({
      startConversation: vi.fn().mockResolvedValue('conv-408-content'),
      startAgentTurn: vi.fn().mockResolvedValue('msg-408-content'),
    })

    const getFinalResult = vi.fn()
    mockAgent.streamGenerate = vi.fn().mockResolvedValueOnce({
      baseStream: null,
      textStream: (async function* () {
        yield 'partial response text'
        throw make408Error()
      })(),
      getFinalResult,
    })

    const { server, messageHandler } = await setupServerWithConnection(httpServer, {
      agents: mockAgents,
      defaultAgent: 'test-agent',
      messagePersistence: mockPersistence,
    })

    await messageHandler({
      message: 'Test message',
      agentId: 'test-agent',
      context: { metadata: { appId: 'test-app' } },
    })

    const allEmits = mockSocket.emit.mock.calls
    const completeEvents = allEmits.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'complete'
    )
    const errorEvents = allEmits.filter(
      (call: any[]) => call[0] === 'message' && call[1]?.type === 'error'
    )

    expect(completeEvents).toHaveLength(1)
    expect(completeEvents[0][1].data.finishReason).toBe('incomplete')
    expect(errorEvents).toHaveLength(0)
    expect(getFinalResult).not.toHaveBeenCalled()

    server.close()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/ai-transport test experimental-websocket-server -t "408 upstream timeout"`
Expected: FAIL — currently the 408 misses the `isNetworkError`-only gate, so it emits a `type:'error'` and no `incomplete` complete.

- [ ] **Step 3: Write the implementation**

In `packages/ai-transport/src/experimental-websocket-server.ts`, update the import on line 46:

```typescript
import { analyzeStreamError, isNetworkError, isUpstreamTimeoutError } from './analyze-stream-error.js'
```

Replace the soft-commit gate (lines 4030-4045):

```typescript
      if (isNetworkError(postStreamError) || isUpstreamTimeoutError(postStreamError)) {
        const content = this.getConversation(socket.id)?.accumulatedContent ?? ''
        const outcome = decideChunkTimeoutFinalization({ isFinished: false, hasContent: content.length > 0 })
        if (outcome.kind === 'finalize') {
          this.logger.warn('stream.premature_close.soft_commit', {
            socketId: socket.id, agentName, step: currentStep, finishReason: outcome.finishReason,
            trigger: isUpstreamTimeoutError(postStreamError) ? 'upstream_timeout' : 'network_close',
            statusCode: analyzeStreamError(postStreamError).statusCode,
          })
          // Honest error span (the upstream DID fail); the soft wire-facing
          // finishReason travels to completeConversation via pendingSoftCommitReason.
          invocation.endError(postStreamError, { finishReason: outcome.finishReason })
          this.pendingSoftCommitReason.set(socket.id, outcome.finishReason)
          // Mirror the abort path: don't publish complete here — the handoff
          // loop in handleChatMessageInternal publishes it after we return.
          return { steps: executionSteps }
        }
      }
```

Update the comment above (lines 4020-4029) — append after "body timeout)":

```typescript
      // Premature upstream close (undici `terminated`, socket reset, body
      // timeout) OR an upstream request-timeout HTTP response (GoCode 408 /
      // gateway 504) that did NOT abort the signal. If content already
      // streamed, soft-commit it (finishReason 'incomplete') so the client
      // shows the gentle "may be incomplete" advisory instead of a hard error.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/ai-transport test experimental-websocket-server -t "408 upstream timeout"`
Expected: PASS — one `complete` with `finishReason:'incomplete'`, zero error events, `getFinalResult` not called.

- [ ] **Step 5: Run the full WS premature-close suite for regressions**

Run: `pnpm --filter @airo/ai-transport test experimental-websocket-server -t "premature close"`
Expected: PASS — existing network-close tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-transport/src/experimental-websocket-server.ts packages/ai-transport/src/__tests__/experimental-websocket-server.test.ts
git commit -m "feat(ai-transport): soft-commit 408/504 upstream timeouts in WS transport"
```

---

## Task 5: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck all touched packages**

Run: `pnpm --filter @airo/ai-transport --filter @airo/agents typecheck`
Expected: PASS, no type errors.

- [ ] **Step 2: Lint touched packages**

Run: `pnpm --filter @airo/ai-transport --filter @airo/agents lint`
Expected: PASS.

- [ ] **Step 3: Run full unit suites**

Run: `pnpm --filter @airo/ai-transport test` then `pnpm --filter @airo/agents test:unit`
Expected: PASS. (Note from prior work: do NOT run `@airo/ai-transport` `build` before `test` — stale `dist/*.test.js` artifacts can report false failures; `vitest run` over `src` is the source of truth.)

- [ ] **Step 4: Build**

Run: `pnpm --filter @airo/ai-transport --filter @airo/agents build`
Expected: PASS.

- [ ] **Step 5: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore: lint/format fixups for 408 timeout soft-commit"
```

---

## Self-Review

**Spec coverage:**
- Component 1 (`isUpstreamTimeoutError`) → Task 1 ✓
- Component 2 (SSE gate) → Task 3 ✓
- Component 3 (WS gate) → Task 4 ✓
- Component 4 (friendly message) → Task 2 ✓
- Observability (statusCode/trigger log field, both transports) → Task 3 Step 3 + Task 4 Step 3 ✓
- Testing plan (predicate, SSE both cases, WS, classify) → Tasks 1-4 ✓; full gate → Task 5 ✓
- Acceptance criteria 1-5 all map to the tests above (partial preserved → Task 3/4 content-present; friendly message → Task 2; SSE/WS parity → Tasks 3+4; queryable log field → Task 3/4; no client/i18n change → none touched) ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**Type/name consistency:** `isUpstreamTimeoutError` used identically across Tasks 1-4; `clientMessage` string identical in Task 2 impl + tests; log event names match existing (`sse.stream.premature_close.soft_commit`, `stream.premature_close.soft_commit`). ✓

**Out-of-scope confirmed absent:** no resume/auto-continue, no prevention work, no client changes. ✓
