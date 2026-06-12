---
title: GoCode x-correlation-id architecture decisions
date: 2026-04-16
last_updated: 2026-04-16
category: best-practices
module: ai-transport, ai-lib, ai-grants, ai-common, agents
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Adding cross-service tracing headers to LLM calls
  - Extracting response headers from GoCode/AI SDK streaming responses
  - Passing OTel context through packages that don't have OTel as a dependency
  - Injecting request headers in custom fetch wrappers
tags:
  - correlation-id
  - gocode
  - response-headers
  - otel
  - litellm-metadata
  - onLlmEnd
  - cross-service-tracing
  - x-trace-id
---

# GoCode x-correlation-id Architecture Decisions

## Context

GoCode creates an `x-correlation-id` per LLM request for cross-service tracing. The agents service needs to extract it from GoCode response headers and log it. Agents also send `x-trace-id` (OTel trace ID) to GoCode for bidirectional correlation. This required decisions about extraction layer, cross-package data flow, async timing, and OTel context handling.

Team agreement (Slack, 2026-04-15): use `x-correlation-id` (GoCode's ID), not `x-litellm-call-id` (LiteLLM's ID), across all services. (auto memory [claude])

## Guidance

### 1. Extract response headers in ai-transport, not ai-lib

ai-lib's fetch wrappers return a `Response` to the AI SDK. By the time headers are accessible as `capturedResponseHeaders`, we're in ai-transport. ai-lib has no visibility into response headers after the fetch returns.

`capturedResponseHeaders` in `streamAgentResponse()` already captures all response headers via `.then()` on `streamResult.response`. Extracting `x-correlation-id` is a single property access.

### 2. Surface to agents via onLlmEnd callback

The `onLlmEnd` callback interface fires per LLM round. Added `correlationId?: string` to its data type. The agents websocket server config (`ai-lib-websocket-server.ts`) wires the `onLlmEnd` handler to log `llm.call.end` events.

The `onLlmEnd` handler always emits `llm.call.end` (all providers get observability). `correlationId` is conditionally spread when present:

```typescript
onLlmEnd: async (data) => {
  logger.info('llm.call.end', {
    socketId: data.socketId,
    model: data.model,
    provider: data.provider,
    ...(data.correlationId && { correlationId: data.correlationId }),
    ...(data.conversationId && { conversationId: data.conversationId }),
    ...(data.appId && { appId: data.appId }),
  })
},
```

### 3. Reuse extractResponseMetadata for header await (timing race)

`capturedResponseHeaders` is set via fire-and-forget `.then()`. The `onLlmEnd` block runs after stream consumption on a separate async path. Race: `onLlmEnd` can fire before `.then()` resolves, leaving `capturedResponseHeaders` undefined.

Reuse the existing `extractResponseMetadata()` helper (500ms timeout race) instead of inlining a duplicate:

```typescript
if (streamResult && !capturedResponseHeaders) {
  const meta = await this.extractResponseMetadata(streamResult)
  capturedResponseHeaders ??= meta.headers
  capturedResponseId ??= meta.responseId
  capturedModelId ??= meta.modelId
}
```

(session history) Initial implementation inlined a 20-line `Promise.race` block. PR review caught the duplication with the existing helper.

### 4. Use trace.getSpan(invocation.context), not trace.getActiveSpan()

The OTel trace ID injection happens BEFORE `otelContext.with(invocation.context, ...)` executes the LLM call. At that point, the invocation span is created but not active. `trace.getActiveSpan()` returns the wrong span (or undefined).

Use `trace.getSpan(invocation.context)` to read the span directly from the invocation context:

```typescript
const invocationSpan = trace.getSpan(invocation.context)
if (invocationSpan && context) {
  const traceId = invocationSpan.spanContext().traceId
  if (traceId) {
    const metadata = (context as ProcessedContext).metadata
    if (metadata) {
      metadata.traceId = traceId
    }
  }
}
```

Use `ProcessedContext` type cast (not `any`) for `context.metadata` access. `ProcessedContext` (line 65) declares `metadata?: Record<string, unknown>`.

(session history) Initial implementation used `trace.getActiveSpan()` and `(context as any).metadata`. Both caught in PR review.

### 5. Pass traceId via LitellmMetadata, not direct OTel import

ai-lib has no `@opentelemetry/api` dependency. Add `traceId?: string` to `LitellmMetadata` (ai-common) and `ExecutionContextMetadata` (ai-grants). ai-transport writes traceId into execution context metadata before the LLM call. `buildLitellmMetadataFromContext` spreads `traceFields` across all return paths (same pattern as `budgetFields`). Both fetch wrappers read `metadata.traceId` and set `x-trace-id` header:

```typescript
if (metadata?.traceId) {
  headers.set('x-trace-id', metadata.traceId)
}
```

### 6. Header casing: AI SDK lowercases keys

The AI SDK converts response headers to `Record<string, string>` with lowercased keys. Access as `headers['x-correlation-id']`.

## Why This Matters

- GoCode team traces LLM requests through agent logs for debugging
- The agent team uses correlationId for per-round cost attribution when rounds fail
- BMS migrating from `callRequestId` (litellm call-id) to `correlationId` (GoCode ID)
- The timing race (point 3) causes intermittent missing correlationIds without the await
- The span context bug (point 4) silently prevents traceId injection without logging

## When to Apply

- Adding response header extraction from GoCode/AI SDK streaming responses
- Passing OTel or tracing context through ai-lib (use LitellmMetadata, not direct OTel import)
- Adding fields to onLlmEnd or similar per-round callbacks
- Reading capturedResponseHeaders in happy-path code
- Injecting request headers in fetch wrappers (audit retry paths per budget-headers-inherited learning)

## Examples

**Data flow (response direction):**
GoCode response headers -> ai-transport `capturedResponseHeaders` -> `extractResponseMetadata()` -> `onLlmEnd` callback data -> agents `logger.info('llm.call.end', { correlationId })`

**Data flow (request direction):**
ai-transport `trace.getSpan(invocation.context)` -> `context.metadata.traceId` -> `buildLitellmMetadataFromContext` traceFields -> `llmMetadataContext` AsyncLocalStorage -> ai-lib fetch wrapper `headers.set('x-trace-id', metadata.traceId)` -> GoCode

**Key files:**
- `packages/ai-transport/src/experimental-websocket-server.ts` -- extraction + OTel injection
- `packages/ai-common/src/llm-metadata.ts` -- LitellmMetadata interface
- `packages/ai-grants/src/build-metadata.ts` -- ExecutionContextMetadata + traceFields spread
- `packages/ai-lib/src/providers/unified-provider.ts` -- fetch wrapper header injection
- `agents/src/server/ai-lib-websocket-server.ts` -- onLlmEnd callback wiring
- `agents/src/logging/types.ts` -- LogContext correlationId field

## Current Status (re-applied, live as of 2026-06)

**RE-APPLIED / LIVE.** The traceId/correlationId implementation described in this doc is back in the codebase and shipping. Verified: `headers.set('x-trace-id', metadata.traceId)` in both fetch wrappers at `packages/ai-lib/src/providers/unified-provider.ts` (lines 416 and 518); `traceId?: string` on `LitellmMetadata` in `packages/ai-common/src/llm-metadata.ts`; the `onLlmEnd` callback wires `correlationId` into `llm.call.end` in `agents/src/server/ai-lib-websocket-server.ts` (~line 2587). The Guidance body below describes the shipped code.

## Related

- Slack thread (2026-04-15): team agreement on correlationId standardization
- `docs/solutions/logic-errors/websocket-onmessagestart-context-metadata-timing-2026-04-13.md` -- callback lifecycle ordering
- `docs/solutions/logic-errors/budget-headers-inherited-on-grant-fallback-retry-2026-04-06.md` -- fetch wrapper header leakage on retry
