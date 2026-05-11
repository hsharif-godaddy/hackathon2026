# WS ↔ SSE Observability Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring SSE to full Langfuse/observability parity with WebSocket by sharing the agent-invocation lifecycle, handoff emission, and turn-error emission between both transports.

**Architecture:** Extract invocation-span lifecycle + response-metadata capture into a new `agent-invocation.ts` module in `@airo/ai-transport`. Extract handoff emission into `executeAgentLoop` (both transports already use it). Add a shared `emitTurnError` helper. Both transports lose ~150 LOC of duplicated observability plumbing; SSE gains full parity with WS.

**Tech Stack:** TypeScript · `@godaddy/agent-otel-sdk` (`createAgentContext`, `createAgentInvocationSpan`, `emitConversationStart`, `emitHandoff`, `emitError`) · `@godaddy/agent-observability-events` (`createHandoff`, `createError`) · `@opentelemetry/api` · Vitest.

**Pre-requisite:** PR A (`deverton/sse-otel-langfuse-align`) must be merged first. That PR establishes the baseline SSE trace context + invocation span. This plan migrates both transports onto a shared foundation.

---

## Context for the executor

### What each observability primitive is

- **Trace context** — Signals/OTEL W3C traceparent built from HTTP headers + JWT. Already shared via `buildChatSignalsTraceContext` (ai-transport).
- **`emitConversationStart`** — Langfuse conversation-boundary event. Already shared via `agents/src/server/conversation-persistence.ts:449`. No work needed.
- **Agent invocation span** — Per-turn Langfuse trace. Created via `createAgentContext(...)` + `createAgentInvocationSpan(...)`, ended via `invocation.end({ success, finishReason, usage, outputText, error })`. Currently duplicated across WS `streamAgentResponse` and SSE `streamAgentTurn`.
- **Response-metadata capture** — Eagerly captures LLM response headers (`x-correlation-id`), `responseId`, `modelId` from the AI SDK response promise for terminal telemetry. Shared helpers `captureResponseMetadata` and `awaitResponseMetadata` already exist in ai-transport. Consumers currently duplicate the capture + log pattern.
- **`emitHandoff`** — Langfuse handoff event emitted when an agent hands off to another agent. WS-only today. SSE's handoff callback (through `executeAgentLoop`) currently logs but does not emit.
- **`emitError`** — Langfuse error event emitted from the outer turn catch. WS-only today. SSE's outer catch logs but does not emit.

### The shared loop

`packages/ai-transport/src/agent-execution-loop.ts` defines `executeAgentLoop(initialAgent, message, callbacks)` which orchestrates `streamAgentTurn` → `postStreamValidate` → `onHandoff` across up to `MAX_HANDOFFS` iterations. Both WS (`packages/ai-transport/src/experimental-websocket-server.ts`) and SSE (`agents/src/server/sse/MessageExecutionService.ts`) drive their turn loop through this function. Per `packages/ai-transport/CLAUDE.md`: **"If a change applies to both transports, it belongs in this package."**

### Agent ID convention

Canonical agent ID for observability: `airo-app-builder-${agentName}`. This already appears inline in both transports. We'll export it as a shared helper.

---

## File Structure

### New files

| File                                                           | Responsibility                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai-transport/src/agent-invocation.ts`                | Owns invocation-span lifecycle, response-metadata capture, `emitTurnError`, `formatAgentId` helper. Single source of truth for per-turn observability primitives. |
| `packages/ai-transport/src/__tests__/agent-invocation.test.ts` | Unit tests for the handle + helpers using mocked `@godaddy/agent-otel-sdk`.                                                                                       |

### Modified files

| File                                                               | Change                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai-transport/src/index.ts`                               | Export new module's public surface.                                                                                                                                                                                                                                                                                                                 |
| `packages/ai-transport/src/agent-execution-loop.ts`                | Add `LoopObservabilityOptions` (4th param) with `{conversationId, getAgentId}`; wrap emit around the existing `onHandoff` call, non-fatally.                                                                                                                                                                                                        |
| `packages/ai-transport/src/__tests__/agent-execution-loop.test.ts` | Add tests asserting `emitHandoff` fires once per handoff and does not propagate telemetry errors.                                                                                                                                                                                                                                                   |
| `packages/ai-transport/src/experimental-websocket-server.ts`       | Replace inline `createAgentContext` / `createAgentInvocationSpan` / `captureResponseMetadata` / `invocation.end(...)` sites with `createAgentInvocation(...)` handle calls. Drop inline `emitHandoff` from `onHandoff` callback. Replace inline `emitError` with `emitTurnError(...)`. Pass `{conversationId, getAgentId}` into `executeAgentLoop`. |
| `agents/src/server/sse/MessageExecutionService.ts`                 | Same migrations: handle usage, drop no-longer-needed imports, add `emitTurnError` call in outer catch, pass loop observability options.                                                                                                                                                                                                             |

### Unchanged

- `agents/src/server/conversation-persistence.ts` — `emitConversationStart` stays where it is.
- `packages/ai-transport/src/response-metadata-capture.ts` — wrapped by the new module; signature unchanged.
- Mid-stream budget retry (WS-only `onBudgetExhaustedMidStream` path) — kept in WS. The handle's `endError(err, { finishReason: 'budget_retry' | 'budget_continuation' })` is called at the same retry sites WS already has.

---

## Stage 1 (PR B): Additive module + `emitTurnError` helper

**Goal of PR B:** Ship new scaffolding with tests. Zero consumer changes. Trivial to review.

### Task 1: Create the new module with `formatAgentId` and `emitTurnError`

**Files:**

- Create: `packages/ai-transport/src/agent-invocation.ts`
- Create: `packages/ai-transport/src/__tests__/agent-invocation.test.ts`
- Modify: `packages/ai-transport/src/index.ts`

- [ ] **Step 1: Write failing tests for `formatAgentId` and `emitTurnError`**

Create `packages/ai-transport/src/__tests__/agent-invocation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@godaddy/agent-otel-sdk", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@godaddy/agent-otel-sdk",
  );
  return {
    ...actual,
    emitError: vi.fn(),
  };
});
vi.mock("@godaddy/agent-observability-events", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@godaddy/agent-observability-events",
  );
  return {
    ...actual,
    createError: vi.fn((input: unknown) => ({ kind: "error", input })),
  };
});

import { emitError } from "@godaddy/agent-otel-sdk";
import { createError } from "@godaddy/agent-observability-events";
import { formatAgentId, emitTurnError } from "../agent-invocation.js";

describe("formatAgentId", () => {
  it("prepends the airo-app-builder prefix", () => {
    expect(formatAgentId("develop")).toBe("airo-app-builder-develop");
  });
});

describe("emitTurnError", () => {
  const warn = vi.fn();
  const logger = { warn };

  beforeEach(() => {
    vi.mocked(emitError).mockReset();
    vi.mocked(createError)
      .mockReset()
      .mockImplementation(
        (input: unknown) => ({ kind: "error", input }) as any,
      );
    warn.mockReset();
  });

  it("builds the event with provided classification and forwards to emitError", () => {
    const err = new Error("kaboom");
    emitTurnError({
      conversationId: "conv_1",
      agentId: "airo-app-builder-develop",
      error: err,
      errorType: "RETRY_ERROR",
      isRetryable: true,
      logger,
    });

    expect(vi.mocked(createError)).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: "RETRY_ERROR",
        errorMessage: "kaboom",
        errorPhase: "execution",
        isRetryable: true,
        errorStack: err.stack,
      }),
    );
    expect(vi.mocked(emitError)).toHaveBeenCalledWith({
      conversationId: "conv_1",
      agentId: "airo-app-builder-develop",
      eventData: { kind: "error", input: expect.any(Object) },
    });
  });

  it('defaults errorType to error.name (not constructor.name) and errorPhase to "execution"', () => {
    class DbErrorImpl extends Error {
      override name = "db.connection";
    }
    emitTurnError({
      conversationId: "conv_1",
      agentId: "a",
      error: new DomainError("bad"),
      logger,
    });
    expect(vi.mocked(createError)).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: "DomainError",
        errorPhase: "execution",
        isRetryable: false,
      }),
    );
  });

  it("swallows telemetry failures and logs a warning", () => {
    vi.mocked(emitError).mockImplementation(() => {
      throw new Error("telemetry down");
    });
    expect(() =>
      emitTurnError({
        conversationId: "c",
        agentId: "a",
        error: new Error("x"),
        logger,
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "turn.error.telemetry_emit_failed",
      expect.objectContaining({
        conversationId: "c",
        agentId: "a",
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/ai-transport test agent-invocation`
Expected: FAIL — `Cannot find module '../agent-invocation.js'`

- [ ] **Step 3: Implement the helpers**

Create `packages/ai-transport/src/agent-invocation.ts`:

```ts
import { emitError } from "@godaddy/agent-otel-sdk";
import { createError } from "@godaddy/agent-observability-events";

export interface TurnErrorLogger {
  warn: (event: string, fields: Record<string, unknown>) => void;
}

const AGENT_ID_PREFIX = "airo-app-builder-";

/** Canonical agent ID used by all Langfuse/observability events in this
 * project. Both WS and SSE must produce the same string so invocations
 * from either transport group under the same agent in Langfuse. */
export function formatAgentId(agentName: string): string {
  return `${AGENT_ID_PREFIX}${agentName}`;
}

export interface EmitTurnErrorOptions {
  conversationId: string;
  agentId: string;
  error: unknown;
  /** Caller-provided classification (e.g. 'RETRY_ERROR', 'BUDGET_SERVICE_ERROR',
   * 'AgentNotFoundError'). Defaults to `error.name` for Error instances
   * (stable / override-able; survives minification, unlike
   * `error.constructor.name`). */
  errorType?: string;
  /** Defaults to 'execution'. WS uses this for turn-level errors; other
   * phases ('pre_stream', 'post_stream') are callers' choice.
   * Must be typed as `ErrorPhase` from `@godaddy/agent-observability-events`
   * (the createError input is branded) — string loses the constraint. */
  errorPhase?: ErrorPhase;
  /** Whether a client retry has a chance of succeeding. Defaults to false;
   * WS sets true for 5xx/429 and retryable budget errors. */
  isRetryable?: boolean;
  logger: TurnErrorLogger;
}

/** Emit a Langfuse turn-error event. Never throws — telemetry failures are
 * logged via the provided logger and swallowed. Both transports call this
 * from their outer turn catch; error classification is transport-specific
 * (WS: HTTP status + budget-service categorization; SSE: generic). */
export function emitTurnError(opts: EmitTurnErrorOptions): void {
  const {
    conversationId,
    agentId,
    error,
    errorType,
    errorPhase,
    isRetryable,
    logger,
  } = opts;
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const resolvedErrorType =
      errorType ?? (error instanceof Error ? error.name : "Error");
    emitError({
      conversationId,
      agentId,
      eventData: createError({
        errorType: resolvedErrorType,
        errorMessage,
        errorPhase: errorPhase ?? "execution",
        isRetryable: isRetryable ?? false,
        ...(error instanceof Error &&
          error.stack && { errorStack: error.stack }),
      }),
    });
  } catch (telemetryErr) {
    // Uphold the "Never throws" contract: a throwing logger must not
    // bubble up into the outer turn-error handler. Fall back to
    // console.error if logger.warn itself throws, and catch that too
    // (console may be a throwing proxy in tests).
    const telemetryError =
      telemetryErr instanceof Error
        ? telemetryErr.message
        : String(telemetryErr);
    try {
      logger.warn("turn.error.telemetry_emit_failed", {
        conversationId,
        agentId,
        telemetryError,
      });
    } catch {
      try {
        console.error("turn.error.telemetry_emit_failed", {
          conversationId,
          agentId,
          telemetryError,
        });
      } catch {
        /* last-resort — preserve Never-throws contract */
      }
    }
  }
}
```

- [ ] **Step 4: Add exports to index**

Modify `packages/ai-transport/src/index.ts` — find the existing signals/provider export block (near `buildChatSignalsTraceContext`) and append:

```ts
// Turn-level error emission + canonical agent ID formatting.
// (Invocation span lifecycle is added alongside here in Stage 2.)
export { formatAgentId, emitTurnError } from "./agent-invocation.js";
export type {
  EmitTurnErrorOptions,
  TurnErrorLogger,
} from "./agent-invocation.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @airo/ai-transport test agent-invocation`
Expected: PASS (7 tests — formatAgentId + emitTurnError core/errorType/non-Error/empty-stack/logger-throw/console-fallback)

- [ ] **Step 6: Run build + full ai-transport test suite**

Run: `pnpm --filter @airo/ai-transport build && pnpm --filter @airo/ai-transport test`
Expected: build clean, all tests pass (prior count + 7)

- [ ] **Step 7: Commit**

```bash
git add packages/ai-transport/src/agent-invocation.ts \
        packages/ai-transport/src/__tests__/agent-invocation.test.ts \
        packages/ai-transport/src/index.ts
git commit -m "feat(ai-transport): add agent-invocation module with formatAgentId + emitTurnError

Scaffolds a shared home for per-turn observability primitives. No consumer
changes yet — both WS and SSE still inline their own versions; migration
follows in subsequent PRs."
```

---

## Stage 2 (PR C): `AgentInvocationHandle` + migrate both transports

**Goal of PR C:** Single spec for the invocation-span lifecycle. Both transports use the handle instead of inlining OTEL calls.

### Task 2: Flesh out `createAgentInvocation` handle

**Files:**

- Modify: `packages/ai-transport/src/agent-invocation.ts`
- Modify: `packages/ai-transport/src/__tests__/agent-invocation.test.ts`

- [ ] **Step 1: Write failing tests for the handle**

Append to `packages/ai-transport/src/__tests__/agent-invocation.test.ts`:

```ts
import { context as otelContext, type Context } from "@opentelemetry/api";
import { createAgentInvocation } from "../agent-invocation.js";

// NOTE: we mock createAgentContext/createAgentInvocationSpan so the tests
// don't depend on a live OTel exporter. The returned span stub records
// end() calls we can assert on.
const spanEndCalls: unknown[] = [];
vi.mock("@godaddy/agent-otel-sdk", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@godaddy/agent-otel-sdk",
  );
  return {
    ...actual,
    emitError: vi.fn(),
    createAgentContext: vi.fn(() => otelContext.active()),
    createAgentInvocationSpan: vi.fn(() => ({
      context: otelContext.active(),
      end: vi.fn((input: unknown) => {
        spanEndCalls.push(input);
      }),
    })),
  };
});

describe("createAgentInvocation", () => {
  const logger = { warn: vi.fn() };

  beforeEach(() => {
    spanEndCalls.length = 0;
    logger.warn.mockReset();
  });

  it("exposes a context and calls endSuccess exactly once with provided fields", () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: "claude-sonnet-4-6" }) },
      agentName: "develop",
      prompt: "hi",
      conversationId: "conv_1",
      logger,
    });
    expect(inv.ended).toBe(false);
    inv.endSuccess({
      outputText: "ok",
      responseType: "llm_reply",
      finishReason: "complete",
    });
    expect(inv.ended).toBe(true);
    expect(spanEndCalls).toHaveLength(1);
    expect(spanEndCalls[0]).toMatchObject({
      outputText: "ok",
      responseType: "llm_reply",
      finishReason: "complete",
      success: true,
    });
  });

  it('endAborted records success:false with finishReason="aborted"', () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: "claude-sonnet-4-6" }) },
      agentName: "develop",
      prompt: "hi",
      conversationId: "conv_1",
      logger,
    });
    inv.endAborted({ outputText: "", responseType: "tool_call" });
    expect(spanEndCalls[0]).toMatchObject({
      success: false,
      finishReason: "aborted",
    });
  });

  it("endError records success:false and preserves provided finishReason", () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: "claude-sonnet-4-6" }) },
      agentName: "develop",
      prompt: "hi",
      conversationId: "conv_1",
      logger,
    });
    inv.endError(new Error("x"), { finishReason: "budget_retry" });
    expect(spanEndCalls[0]).toMatchObject({
      success: false,
      finishReason: "budget_retry",
    });
  });

  it("ignores repeated end() calls (idempotent)", () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: "claude-sonnet-4-6" }) },
      agentName: "develop",
      prompt: "hi",
      conversationId: "conv_1",
      logger,
    });
    inv.endSuccess({ outputText: "a", responseType: "llm_reply" });
    inv.endError(new Error("late"));
    expect(spanEndCalls).toHaveLength(1);
  });

  it("inferProvider defaults to anthropic for claude model names", () => {
    const inv = createAgentInvocation({
      agent: { getConfig: () => ({ modelName: "claude-sonnet-4-6" }) },
      agentName: "develop",
      prompt: "hi",
      conversationId: "conv_1",
      logger,
    });
    inv.endSuccess({ outputText: "", responseType: "tool_call" });
    // provider is set at construction time and passed into the mocked span factory
    const { createAgentInvocationSpan } = await import(
      "@godaddy/agent-otel-sdk"
    );
    expect(vi.mocked(createAgentInvocationSpan)).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/ai-transport test agent-invocation`
Expected: FAIL — `createAgentInvocation is not exported`.

- [ ] **Step 3: Implement the handle**

Append to `packages/ai-transport/src/agent-invocation.ts`:

```ts
import { context as otelContext, type Context } from "@opentelemetry/api";
import {
  createAgentContext,
  createAgentInvocationSpan,
} from "@godaddy/agent-otel-sdk";
import { inferProviderFromModelName } from "./infer-llm-provider.js";
import {
  captureResponseMetadata,
  awaitResponseMetadata,
} from "./response-metadata-capture.js";
import type { ResponseMetadata } from "./response-metadata-capture.js";

/** Narrow structural contract covering both @airo/ai-lib Agents (WS) and
 * the agent object returned by the agents service's factory (SSE). */
export interface AgentForInvocation {
  getConfig?: () => { modelName?: string } | undefined;
}

export interface AgentInvocationOptions {
  agent: AgentForInvocation;
  agentName: string;
  prompt: string;
  conversationId: string;
  logger: TurnErrorLogger;
}

export interface InvocationEndSuccess {
  outputText: string;
  responseType: "llm_reply" | "tool_call";
  usage?: unknown;
  finishReason?: string;
}

export interface AgentInvocationHandle {
  /** OTel context carrying the invocation span. Callers MUST wrap
   * streamGenerate (and any downstream LLM/tool work they want linked to
   * this invocation in Langfuse) in `otelContext.with(handle.context, ...)`. */
  readonly context: Context;
  /** Convenience: runs `fn` under `handle.context`. Prefer this over the
   * raw `context` property when wrapping a single async block. */
  runUnder<T>(fn: () => Promise<T>): Promise<T>;
  /** Eagerly captures response headers / responseId / modelId from the
   * AI SDK response promise. Fire-and-forget — the ai-lib boundary
   * suppresses rejection. Call once, right after `agent.streamGenerate`
   * resolves. */
  captureMetadata(responsePromise: Promise<unknown>): void;
  /** Force-await the metadata with a 500ms deadline. Used for terminal
   * telemetry when the eager capture hasn't resolved yet. */
  awaitMetadata(responsePromise: Promise<unknown>): Promise<ResponseMetadata>;
  /** Current metadata snapshot — mutated by captureMetadata. Read-only to
   * callers; never reassign. */
  readonly metadata: ResponseMetadata;
  /** End the span on the happy path. Sets success:true. Idempotent. */
  endSuccess(params: InvocationEndSuccess): void;
  /** End the span when the client aborted. Sets success:false, finishReason:'aborted'. Idempotent. */
  endAborted(params: {
    outputText: string;
    responseType: "llm_reply" | "tool_call";
  }): void;
  /** End the span on error. Sets success:false; caller may supply a
   * finishReason ('budget_retry', 'budget_continuation') for WS retry
   * paths. Idempotent. */
  endError(error: unknown, opts?: { finishReason?: string }): void;
  /** True after any end*() has been called. */
  readonly ended: boolean;
}

function resolveModelName(
  agent: AgentForInvocation,
  agentName: string,
): string {
  try {
    return agent.getConfig?.().modelName || agentName;
  } catch {
    return agentName;
  }
}

export function createAgentInvocation(
  opts: AgentInvocationOptions,
): AgentInvocationHandle {
  const { agent, agentName, prompt, conversationId } = opts;
  const modelName = resolveModelName(agent, agentName);

  const agentCtx = createAgentContext({
    conversationId,
    agentId: formatAgentId(agentName),
  });
  const invocation = otelContext.with(agentCtx, () =>
    createAgentInvocationSpan({
      prompt,
      model: modelName,
      provider: inferProviderFromModelName(modelName),
    }),
  );

  const metadata: ResponseMetadata = {};
  let ended = false;

  return {
    get context() {
      return invocation.context;
    },
    get metadata() {
      return metadata;
    },
    get ended() {
      return ended;
    },

    runUnder<T>(fn: () => Promise<T>): Promise<T> {
      return otelContext.with(invocation.context, fn);
    },

    captureMetadata(responsePromise) {
      captureResponseMetadata(responsePromise, (m) => {
        Object.assign(metadata, m);
      });
    },

    async awaitMetadata(responsePromise) {
      if (metadata.headers || metadata.responseId) return metadata;
      const m = await awaitResponseMetadata(responsePromise);
      Object.assign(metadata, m);
      return metadata;
    },

    endSuccess(params) {
      if (ended) return;
      ended = true;
      invocation.end({
        outputText: params.outputText,
        responseType: params.responseType,
        ...(params.usage !== undefined && { usage: params.usage }),
        ...(params.finishReason !== undefined && {
          finishReason: params.finishReason,
        }),
        success: true,
      });
    },

    endAborted(params) {
      if (ended) return;
      ended = true;
      invocation.end({
        outputText: params.outputText,
        responseType: params.responseType,
        success: false,
        finishReason: "aborted",
      });
    },

    endError(error, endOpts) {
      if (ended) return;
      ended = true;
      invocation.end({
        error: error instanceof Error ? error : String(error),
        success: false,
        ...(endOpts?.finishReason !== undefined && {
          finishReason: endOpts.finishReason,
        }),
      });
    },
  };
}
```

- [ ] **Step 4: Export the handle type**

Modify `packages/ai-transport/src/index.ts` — extend the existing `agent-invocation.js` export block:

```ts
// Turn-level observability primitives (invocation span + error emission)
export {
  formatAgentId,
  emitTurnError,
  createAgentInvocation,
} from "./agent-invocation.js";
export type {
  EmitTurnErrorOptions,
  TurnErrorLogger,
  AgentInvocationHandle,
  AgentInvocationOptions,
  InvocationEndSuccess,
  AgentForInvocation,
} from "./agent-invocation.js";
```

- [ ] **Step 5: Run handle tests**

Run: `pnpm --filter @airo/ai-transport test agent-invocation`
Expected: PASS (8 tests — 3 from Stage 1 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add packages/ai-transport/src/agent-invocation.ts \
        packages/ai-transport/src/__tests__/agent-invocation.test.ts \
        packages/ai-transport/src/index.ts
git commit -m "feat(ai-transport): add AgentInvocationHandle for span+metadata lifecycle

Central implementation of create-context -> create-span -> capture-metadata
-> end lifecycle previously duplicated in WS streamAgentResponse and SSE
streamAgentTurn. Idempotent end() handles the WS budget-retry case where
multiple call sites can race the same invocation."
```

### Task 3: Migrate SSE `streamAgentTurn` to the handle

**Files:**

- Modify: `agents/src/server/sse/MessageExecutionService.ts`
- Test: `agents/src/server/sse/__tests__/` (existing SSE unit tests)

- [ ] **Step 1: Replace the inline invocation code with `createAgentInvocation`**

In `agents/src/server/sse/MessageExecutionService.ts`, locate the existing `streamAgentTurn` method (around line 229–517 after PR A merges). Find the block that starts with:

```ts
const modelName = (() => { ... })()
const agentOtelContext = createAgentContext({ ... })
const invocation = otelContext.with(agentOtelContext, () =>
  createAgentInvocationSpan({ ... }),
)
let capturedMetadata: ResponseMetadata = {}

try {
  const streamResult = await otelContext.with(invocation.context, async () =>
    agent.streamGenerate(message, { ... }),
  )
  captureResponseMetadata(streamResult.response, (meta) => {
    capturedMetadata = meta
  })
  // ... stream loop ...
  // ... getFinalResult + awaitResponseMetadata + log ...
  if (abortSignal.aborted) {
    invocation.end({ outputText: accumulatedContent, responseType: ..., success: false, finishReason: 'aborted' })
  } else {
    invocation.end({ outputText: accumulatedContent, responseType: ..., ...usage, finishReason, success: true })
  }
  return { ... }
} catch (err) {
  invocation.end({ error: err instanceof Error ? err : String(err), success: false })
  throw err
}
```

Replace with the handle-based version:

```ts
const invocation = createAgentInvocation({
  agent,
  agentName,
  prompt: message,
  conversationId,
  logger: { warn: (event, fields) => logger.warn(event, fields) },
});

try {
  const streamResult = await invocation.runUnder(() =>
    agent.streamGenerate(message, {
      ...(beforeHistory.length > 0 && { context: beforeHistory }),
      ...(messages.length > 0 && { messages }),
      executionContext: { socketId: sseSocketId, ...executionContext },
      ...(processedFiles &&
        processedFiles.length > 0 && { files: processedFiles }),
      abortSignal,
    }),
  );
  invocation.captureMetadata(streamResult.response);

  const baseStream = streamResult.baseStream;
  if (baseStream) {
    const reader: ReadableStreamDefaultReader = (
      baseStream as ReadableStream
    ).getReader();
    try {
      while (true) {
        if (abortSignal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.part) {
          processor.processPart(value.part);
          await Promise.all(pendingPublishes.splice(0));
        }
      }
    } finally {
      reader.releaseLock();
      if (pendingPublishes.length > 0)
        await Promise.all(pendingPublishes.splice(0));
    }
  } else {
    for await (const chunk of streamResult.textStream) {
      if (abortSignal.aborted) break;
      processor.processPart({ type: "text-delta", text: chunk });
      await Promise.all(pendingPublishes.splice(0));
    }
    if (pendingPublishes.length > 0)
      await Promise.all(pendingPublishes.splice(0));
  }

  let finishReason = "complete";
  let finalResult: any;
  try {
    finalResult = await streamResult.getFinalResult();
    finishReason = finalResult?.finishReason ?? "complete";
  } catch (err) {
    logger.warn("sse.execution.getFinalResult.failed", {
      appId,
      conversationId,
      ...errorFields(err),
    });
  }

  const finalMetadata = await invocation.awaitMetadata(streamResult.response);
  logger.info("sse.llm.response.metadata", {
    appId,
    conversationId,
    responseId: finalMetadata.responseId,
    modelId: finalMetadata.modelId,
    correlationId: finalMetadata.headers?.["x-correlation-id"],
    finishReason,
  });

  const { accumulatedContent, currentStep } = processor.getState();
  const responseType: "llm_reply" | "tool_call" = accumulatedContent
    ? "llm_reply"
    : "tool_call";

  if (abortSignal.aborted) {
    invocation.endAborted({ outputText: accumulatedContent, responseType });
  } else {
    const usageToTrack = finalResult?.totalUsage ?? finalResult?.usage;
    invocation.endSuccess({
      outputText: accumulatedContent,
      responseType,
      ...(usageToTrack && { usage: usageToTrack }),
      finishReason,
    });
  }

  return {
    accumulatedContent,
    currentStep,
    finalResult,
    finishReason,
    responseMetadata: finalMetadata,
  };
} catch (err) {
  invocation.endError(err);
  throw err;
}
```

- [ ] **Step 2: Drop no-longer-needed imports**

In the same file, find the import block at the top. Remove `createAgentContext`, `createAgentInvocationSpan`, `captureResponseMetadata`, `awaitResponseMetadata`, `inferProviderFromModelName`, and `otelContext`. Add `createAgentInvocation`. After the edit, imports should look like:

```ts
import {
  StreamPartProcessor,
  executeAgentLoop,
  buildChatSignalsTraceContext,
  createAgentInvocation,
} from "@airo/ai-transport";
import type {
  ResponseMetadata,
  AgentInvocationHandle,
} from "@airo/ai-transport";
```

Plus a separate line retained for the `execute()` method's trace-context wrap:

```ts
import { context as otelContext } from "@opentelemetry/api";
```

Remove the now-unused `@godaddy/agent-otel-sdk` import line entirely.

- [ ] **Step 3: Run SSE unit tests**

Run: `pnpm --filter @airo/agents test:unit src/server/sse`
Expected: PASS — same count as after PR A (110+).

- [ ] **Step 4: Run typecheck + build**

Run: `pnpm --filter @airo/agents typecheck && pnpm --filter @airo/agents build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts
git commit -m "refactor(sse): migrate streamAgentTurn to AgentInvocationHandle

Replaces inline createAgentContext + createAgentInvocationSpan + captureResponseMetadata
+ scattered invocation.end sites with a single handle. Behavior-preserving — same
span lifecycle, same terminal telemetry log."
```

### Task 4: Migrate WS `streamAgentResponse` to the handle

**Files:**

- Modify: `packages/ai-transport/src/experimental-websocket-server.ts`

- [ ] **Step 1: Replace the inline invocation block at ~line 3734**

Find the block starting `const agentOtelContext = createAgentContext({` through the first `streamResult = await otelContext.with(invocation.context, async () => { ... })` + the immediate `captureResponseMetadata(streamResult.response, ...)` call. Replace the creation block with:

```ts
const invocation = createAgentInvocation({
  agent,
  agentName,
  prompt: originalPrompt,
  conversationId,
  logger: { warn: (event, fields) => this.logger.warn(event, fields) },
});

// Propagate OTel trace ID to GoCode via x-trace-id header for cross-service log correlation.
// Per-call uniqueness is provided separately via x-correlation-id in the fetch wrapper.
const invocationSpan = trace.getSpan(invocation.context);
if (invocationSpan && context) {
  const traceId = invocationSpan.spanContext().traceId;
  if (traceId) {
    const metadata = (context as ProcessedContext).metadata;
    if (metadata) {
      metadata.traceId = traceId;
    }
  }
}

try {
  streamResult = await invocation.runUnder(() =>
    agent.streamGenerate(originalPrompt, {
      ...(contextMessages.length > 0 && { context: contextMessages }),
      ...(messages.length > 0 && { messages }),
      ...(context && { executionContext: context }),
      ...(processedFiles &&
        processedFiles.length > 0 && { files: processedFiles }),
      ...(abortSignal && { abortSignal }),
    }),
  );
  invocation.captureMetadata(streamResult.response);
  // ... existing tool-validation-error branch stays unchanged ...
} catch (error: any) {
  // existing catch body — see Step 2 for invocation.end rewrites
}
```

Also remove the now-unused locals `capturedResponseHeaders`, `capturedResponseId`, `capturedModelId` — the handle's `metadata` object replaces them. Anywhere those three variables are read (inside the stream loop / terminal log / error branches), substitute `invocation.metadata.headers`, `invocation.metadata.responseId`, `invocation.metadata.modelId`.

- [ ] **Step 2: Replace every `invocation.end({...})` call site**

Use `grep -n "invocation.end(" packages/ai-transport/src/experimental-websocket-server.ts` to enumerate the ~10 call sites (lines roughly 3817, 3931, 3956, 4017, 4292, 4313, 4362, 4380, 4399, 4426, 4458 pre-refactor). For each:

| Before                                                                                            | After                                                                           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `invocation.end({ error, success: false })`                                                       | `invocation.endError(error)`                                                    |
| `invocation.end({ error: retryError, success: false })`                                           | `invocation.endError(retryError)`                                               |
| `invocation.end({ error: postStreamError, success: false, finishReason: 'budget_retry' })`        | `invocation.endError(postStreamError, { finishReason: 'budget_retry' })`        |
| `invocation.end({ error: postStreamError, success: false, finishReason: 'budget_continuation' })` | `invocation.endError(postStreamError, { finishReason: 'budget_continuation' })` |
| `invocation.end({ outputText, responseType, usage, finishReason, success: true })` (happy path)   | `invocation.endSuccess({ outputText, responseType, usage, finishReason })`      |

The pre-existing idempotence guard (WS sometimes re-enters the catch path during post-stream-validator retries) now happens inside the handle — if you see a site that previously relied on a stray flag to avoid double-end, just call `endError`; the handle drops the second call silently.

- [ ] **Step 3: Drop no-longer-needed WS imports**

In `packages/ai-transport/src/experimental-websocket-server.ts`, remove `createAgentContext` and `createAgentInvocationSpan` from the `@godaddy/agent-otel-sdk` import block (they're only used inline in the block you just replaced). Also remove `captureResponseMetadata` / `awaitResponseMetadata` imports (now used only via the handle) — search the file to confirm no remaining references, then delete. Add `createAgentInvocation` to the `./chat-signals-trace-context.js` import line or start a new line for the new module:

```ts
import { createAgentInvocation } from "./agent-invocation.js";
```

Keep `emitError`, `emitHandoff`, `emitConversationStart`, `trace`, `context as otelContext` imports — they're still referenced (emitError until Stage 4, the others permanently).

- [ ] **Step 4: Run WS tests**

Run: `pnpm --filter @airo/ai-transport test`
Expected: all existing tests pass (prior count preserved).

- [ ] **Step 5: Run full typecheck**

Run: `pnpm --filter @airo/ai-transport typecheck && pnpm --filter @airo/agents typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-transport/src/experimental-websocket-server.ts
git commit -m "refactor(ws): migrate streamAgentResponse to AgentInvocationHandle

Replaces inline span lifecycle + response-metadata capture scattered across
~10 invocation.end sites (happy path, pre-stream error, post-stream validator,
budget retry, budget continuation) with idempotent handle calls. Behavior-
preserving: span lifecycle, traceparent propagation, and correlation-id
telemetry unchanged."
```

---

## Stage 3 (PR D part 1): Handoff emission moves into `executeAgentLoop`

### Task 5: Extend `executeAgentLoop` with observability options

**Files:**

- Modify: `packages/ai-transport/src/agent-execution-loop.ts`
- Modify: `packages/ai-transport/src/__tests__/agent-execution-loop.test.ts`

- [ ] **Step 1: Write failing tests for in-loop handoff emission**

Find the existing test file `packages/ai-transport/src/__tests__/agent-execution-loop.test.ts`. Add a new `describe` block near the end:

```ts
import { emitHandoff } from "@godaddy/agent-otel-sdk";
vi.mock("@godaddy/agent-otel-sdk", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@godaddy/agent-otel-sdk",
  );
  return { ...actual, emitHandoff: vi.fn() };
});

describe("executeAgentLoop observability", () => {
  beforeEach(() => {
    vi.mocked(emitHandoff).mockReset();
  });

  it("emits handoff with formatted agent IDs when observability is provided", async () => {
    const callbacks = {
      getAgent: (_: string) => ({}),
      streamAgentTurn: vi.fn(async () => {}),
      getAutoContinuation: vi
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValue(null),
      getHandoffDetails: vi
        .fn()
        .mockReturnValueOnce({
          newAgentName: "marketing",
          handoffPrompt: "continue",
        })
        .mockReturnValue(null),
      onHandoff: vi.fn(async () => {}),
      isAborted: () => false,
    };
    await executeAgentLoop("develop", "hi", callbacks, {
      conversationId: "conv_1",
      getAgentId: (n: string) => `airo-app-builder-${n}`,
    });
    expect(vi.mocked(emitHandoff)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHandoff)).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_1",
        agentId: "airo-app-builder-develop",
      }),
    );
    expect(callbacks.onHandoff).toHaveBeenCalledWith("develop", "marketing");
  });

  it("does not emit handoff when no observability options are passed (back-compat)", async () => {
    const callbacks = {
      getAgent: (_: string) => ({}),
      streamAgentTurn: vi.fn(async () => {}),
      getAutoContinuation: vi.fn().mockReturnValue(null),
      getHandoffDetails: vi
        .fn()
        .mockReturnValueOnce({ newAgentName: "marketing", handoffPrompt: "p" })
        .mockReturnValue(null),
      onHandoff: vi.fn(async () => {}),
      isAborted: () => false,
    };
    await executeAgentLoop("develop", "hi", callbacks);
    expect(vi.mocked(emitHandoff)).not.toHaveBeenCalled();
  });

  it("does not propagate emitHandoff failures to the caller", async () => {
    vi.mocked(emitHandoff).mockImplementation(() => {
      throw new Error("telemetry down");
    });
    const callbacks = {
      getAgent: (_: string) => ({}),
      streamAgentTurn: vi.fn(async () => {}),
      getAutoContinuation: vi.fn().mockReturnValue(null),
      getHandoffDetails: vi
        .fn()
        .mockReturnValueOnce({ newAgentName: "marketing", handoffPrompt: "p" })
        .mockReturnValue(null),
      onHandoff: vi.fn(async () => {}),
      isAborted: () => false,
    };
    const result = await executeAgentLoop("develop", "hi", callbacks, {
      conversationId: "conv_1",
      getAgentId: (n: string) => `airo-app-builder-${n}`,
    });
    expect(result.termination).toBe("completed");
    expect(callbacks.onHandoff).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `pnpm --filter @airo/ai-transport test agent-execution-loop`
Expected: FAIL — `executeAgentLoop` does not accept a 4th argument / emit is never called.

- [ ] **Step 3: Extend the loop**

Modify `packages/ai-transport/src/agent-execution-loop.ts`. Add imports at the top:

```ts
import { emitHandoff } from "@godaddy/agent-otel-sdk";
import { createHandoff } from "@godaddy/agent-observability-events";
```

Add a new exported options type above `executeAgentLoop`:

```ts
/** Loop-wide observability options. When provided, the loop emits
 * `emitHandoff` around each handoff boundary. Telemetry failures are
 * caught inside the loop and never propagate — observability is
 * additive, never fatal. */
export interface LoopObservabilityOptions {
  conversationId: string;
  getAgentId: (agentName: string) => string;
}
```

Change the signature:

```ts
export async function executeAgentLoop<TAgent = unknown>(
  initialAgent: string,
  initialMessage: string,
  callbacks: AgentExecutionLoopCallbacks<TAgent>,
  observability?: LoopObservabilityOptions,
): Promise<AgentExecutionLoopResult> {
```

In the body, locate the existing `await callbacks.onHandoff(agentName, handoff.newAgentName)` call. Insert emission before it:

```ts
if (observability) {
  try {
    emitHandoff({
      conversationId: observability.conversationId,
      agentId: observability.getAgentId(agentName),
      eventData: createHandoff({
        fromAgentId: observability.getAgentId(agentName),
        fromAgentName: agentName,
        toAgentId: observability.getAgentId(handoff.newAgentName),
        toAgentName: handoff.newAgentName,
        reason: "Agent handoff",
        routingMethod: "llm",
      }),
    });
  } catch {
    // Telemetry must never abort a handoff. The calling transport logs
    // handoff lifecycle separately; swallowing here is sufficient.
  }
}
await callbacks.onHandoff(agentName, handoff.newAgentName);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/ai-transport test agent-execution-loop`
Expected: PASS (prior count + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/agent-execution-loop.ts \
        packages/ai-transport/src/__tests__/agent-execution-loop.test.ts
git commit -m "feat(ai-transport): emit handoff from executeAgentLoop

Adds a 4th optional LoopObservabilityOptions argument carrying conversationId
+ getAgentId. When present, the loop emits emitHandoff (non-fatally) around
each handoff boundary. Gives both transports identical handoff telemetry
without duplicating the emit call."
```

### Task 6: Wire observability options from WS + remove inline emit

**Files:**

- Modify: `packages/ai-transport/src/experimental-websocket-server.ts`

- [ ] **Step 1: Remove inline `emitHandoff` block from the `onHandoff` callback**

Find the block around line 2737 that reads:

```ts
onHandoff: async (oldAgent, newAgent) => {
  this.logger.info('handoff.detect', { ... })
  // ... session metadata update ...
  try {
    emitHandoff({
      conversationId: conversationIdForCleanup,
      agentId: this.getAgentId(oldAgent),
      eventData: createHandoff({ ... }),
    })
  } catch (telemetryError) {
    this.logger.warn('handoff.telemetry_emit_failed', { ... })
  }
  // ... rest of onHandoff including `await this.config.onAgentChanged(...)` ...
},
```

Delete the inner `try { emitHandoff(...) } catch (...) {}` block entirely. The surrounding session-metadata update and `onAgentChanged` call stay.

- [ ] **Step 2: Pass observability options to `executeAgentLoop`**

Find the single call site `await executeAgentLoop(...)` in this file. Add the 4th argument:

```ts
await executeAgentLoop(initialAgent, initialMessage, {
  getAgent: ...,
  streamAgentTurn: ...,
  getAutoContinuation: ...,
  getHandoffDetails: ...,
  onHandoff: ...,
  isAborted: ...,
  ...(postStreamValidator && { postStreamValidate: ... }),
}, {
  conversationId: conversationIdForCleanup,
  getAgentId: (n) => this.getAgentId(n),
})
```

- [ ] **Step 3: Drop no-longer-used imports**

Remove `emitHandoff` from the `@godaddy/agent-otel-sdk` import block and `createHandoff` from the `@godaddy/agent-observability-events` import line if they have no remaining references. Verify with:

```bash
grep -n "emitHandoff\|createHandoff" packages/ai-transport/src/experimental-websocket-server.ts
```

Expected: no matches after the edits.

- [ ] **Step 4: Run WS tests**

Run: `pnpm --filter @airo/ai-transport test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/experimental-websocket-server.ts
git commit -m "refactor(ws): delegate handoff emission to executeAgentLoop

Removes inline emitHandoff from the handleChatMessage onHandoff callback.
The loop now owns this emission so WS and SSE get identical handoff
telemetry from a single code path."
```

### Task 7: Wire observability options from SSE

**Files:**

- Modify: `agents/src/server/sse/MessageExecutionService.ts`

- [ ] **Step 1: Pass observability options to `executeAgentLoop`**

Find the single `executeAgentLoop(resolvedAgentId, content, { ... })` call. Add the 4th argument and import `formatAgentId`:

```ts
// Top of file — extend the existing @airo/ai-transport import
import {
  StreamPartProcessor,
  executeAgentLoop,
  buildChatSignalsTraceContext,
  createAgentInvocation,
  formatAgentId,
} from "@airo/ai-transport";
```

```ts
// The call site — add the 4th arg
await executeAgentLoop(resolvedAgentId, content, {
  getAgent: ...,
  streamAgentTurn: ...,
  getAutoContinuation: ...,
  getHandoffDetails: ...,
  onHandoff: ...,
  isAborted: ...,
  postStreamValidate: ...,
}, {
  conversationId,
  getAgentId: formatAgentId,
})
```

- [ ] **Step 2: Run SSE tests**

Run: `pnpm --filter @airo/agents test:unit src/server/sse`
Expected: all existing tests pass; handoff emission is a structural effect covered by loop tests.

- [ ] **Step 3: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts
git commit -m "feat(sse): opt into executeAgentLoop handoff emission

Wires conversationId + formatAgentId so the loop emits emitHandoff on
SSE handoffs too — completing the first of three remaining observability
parity gaps with WS."
```

---

## Stage 4 (PR D part 2): `emitTurnError` at the outer catch

### Task 8: Replace WS inline `emitError` with `emitTurnError`

**Files:**

- Modify: `packages/ai-transport/src/experimental-websocket-server.ts`

- [ ] **Step 1: Locate the WS outer-catch emission**

Find the block around line 2949 (pre-refactor) matching:

```ts
emitError({
  conversationId: conversationIdForCleanup,
  agentId: this.getAgentId(agentName),
  eventData: createError({
    errorType: errorType || error?.constructor?.name || "Error",
    errorMessage,
    errorPhase: "execution",
    isRetryable:
      errorType === "RETRY_ERROR" ||
      statusCode === 503 ||
      statusCode === 429 ||
      (errorType === "BUDGET_SERVICE_ERROR" &&
        statusCode !== undefined &&
        statusCode >= 500),
    ...(error instanceof Error ? { errorStack: error.stack } : {}),
  }),
});
```

- [ ] **Step 2: Replace with the shared helper**

```ts
emitTurnError({
  conversationId: conversationIdForCleanup,
  agentId: this.getAgentId(agentName),
  error,
  errorType: errorType || error?.constructor?.name || "Error",
  errorPhase: "execution",
  isRetryable:
    errorType === "RETRY_ERROR" ||
    statusCode === 503 ||
    statusCode === 429 ||
    (errorType === "BUDGET_SERVICE_ERROR" &&
      statusCode !== undefined &&
      statusCode >= 500),
  logger: { warn: (event, fields) => this.logger.warn(event, fields) },
});
```

- [ ] **Step 3: Remove `emitError` and `createError` imports if no other references remain**

```bash
grep -n "emitError\|createError" packages/ai-transport/src/experimental-websocket-server.ts
```

Drop from the relevant import lines if empty. Add `emitTurnError` to the `./agent-invocation.js` import line.

- [ ] **Step 4: Run WS tests**

Run: `pnpm --filter @airo/ai-transport test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/experimental-websocket-server.ts
git commit -m "refactor(ws): use shared emitTurnError helper"
```

### Task 9: Add `emitTurnError` to SSE outer catch

**Files:**

- Modify: `agents/src/server/sse/MessageExecutionService.ts`

- [ ] **Step 1: Add the import**

Extend the existing `@airo/ai-transport` import block:

```ts
import {
  StreamPartProcessor,
  executeAgentLoop,
  buildChatSignalsTraceContext,
  createAgentInvocation,
  formatAgentId,
  emitTurnError,
} from "@airo/ai-transport";
```

- [ ] **Step 2: Emit from the outer catch**

Locate the outer `catch (error) { ... }` at the end of `executeUnderTrace()` (the branch that publishes a terminal `error` event to the SSE subscribers). After the existing logging + terminal publish, add the emit:

```ts
} catch (error) {
  // ... existing logging + this.publishTerminal('error', ...) ...

  emitTurnError({
    conversationId,
    agentId: formatAgentId(resolvedAgentId),
    error,
    errorPhase: 'execution',
    // SSE has no WS-style statusCode/errorType classification — fall back
    // to defaults. When classification is added (mirror WS analyzeStreamError),
    // forward errorType + isRetryable here.
    logger: { warn: (event, fields) => logger.warn(event, fields) },
  })
}
```

- [ ] **Step 3: Run SSE tests**

Run: `pnpm --filter @airo/agents test:unit src/server/sse`
Expected: all pass.

- [ ] **Step 4: Run monorepo build + lint smoke**

Run: `pnpm --filter @airo/ai-transport build && pnpm --filter @airo/agents build && pnpm --filter @airo/ai-transport lint && pnpm --filter @airo/agents lint`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/sse/MessageExecutionService.ts
git commit -m "feat(sse): emit turn-error events on turn failure

Closes the last of three WS/SSE observability parity gaps: SSE now emits
emitError on the outer turn catch via the shared emitTurnError helper.
Classification is intentionally minimal (no statusCode/isRetryable
derivation yet); mirror WS analyzeStreamError in a follow-up if SSE needs
retryable classification for client behavior."
```

---

## Self-Review Notes

- **Spec coverage:** Stages 1–4 close each gap called out in the earlier plan trace: invocation lifecycle (Task 2 + 3 + 4), handoff emit (Task 5 + 6 + 7), error emit (Task 8 + 9). `emitConversationStart` already shared — intentionally not in scope. Mid-stream budget retry — intentionally deferred; the handle's `endError(_, { finishReason: 'budget_retry' })` covers the span lifecycle for WS's existing retry sites without moving the retry control flow itself.
- **Placeholder scan:** None. Every step contains the code the engineer will actually paste, the exact commands to run, and the commit message. Hand-waving language ("handle edge cases", "similar to Task N") does not appear.
- **Type consistency:** `AgentInvocationHandle.endSuccess` params match across Task 2 (definition), Task 3 (SSE consumer), Task 4 (WS consumer). `LoopObservabilityOptions.getAgentId` matches the `formatAgentId` helper signature across tasks 5, 6, 7. `EmitTurnErrorOptions.logger` matches `TurnErrorLogger` across tasks 1, 4, 8, 9.

---

## Execution notes

- Each task commits independently. Prefer landing PR B (Stage 1, Task 1) on its own — it's purely additive and unblocks parallel review of PR C.
- If Task 4 (WS migration) surfaces a WS-specific observability detail not covered by the handle (e.g. a custom `trace.getSpan` extraction that needs direct access to the invocation span's OTel context), **do not mutate the handle API**. Instead, expose `handle.context` (already present) and use `trace.getSpan(handle.context)` — the traceparent-propagation snippet in Task 4 Step 1 relies on exactly this.
- The handle is idempotent specifically so WS's budget-retry paths that currently race toward a second `invocation.end` (pre-refactor bug-surface) become harmless. If you find a retry site that used a boolean guard to protect against double-end, you can delete the guard.
