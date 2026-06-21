# @airo/ai-transport

Infrastructure for the SSE chat server. The SSE adapter (`agents/src/server/sse/MessageExecutionService.ts`) wires callbacks — the behavior lives here. (The WebSocket transport was removed in AIROBUILD-2632; this package is now SSE-only but stays callback-driven rather than branching on transport.)

**Cross-cutting chat behavior belongs in this package**, behind a callback interface, rather than inlined into the SSE adapter.

## What lives here

| Module | Responsibility |
| --- | --- |
| `agent-execution-loop.ts` | Handoff + auto-continuation loop. Transport-agnostic via callbacks. |
| `stream-part-processor.ts` | AI SDK stream-part → tool/text lifecycle events. |
| `conversation-event-channel.ts` | Pub/sub event channel with per-conversation circular buffer for replay. |
| `subscribers/` | `SSESubscriber`, `BaseEventSubscriber`, `PersistenceSubscriber`, `APMSubscriber`, `EventCoalescer`. |
| `client-action-registry.ts` | Client-side action dispatch. |
| `sse-format.ts`, `sse-writer.ts` | SSE wire format — also consumed by the SSE client. |
| `coalesce-events.ts`, `chunk-timeout-guard.ts`, `stream-timing-tracker.ts` | Shared utilities. |

## Rules

1. **The SSE adapter wires callbacks, this package doesn't branch on transport.** Keep behavior here behind the callback seams rather than reaching into the SSE server.

2. **Shared behavior goes behind an existing callback interface.** `AgentExecutionLoopCallbacks`, `PartProcessorCallbacks`, and the subscriber interfaces are the seams. Extend them rather than duplicating logic between this package and the SSE adapter.

3. **Respect the documented error contracts.** `AgentExecutionLoopCallbacks` and `PartProcessorCallbacks` have JSDoc that spells out which hooks may throw (fatal — propagates and aborts the turn) and which must not (additive — implementor wraps in try/catch). When you add a hook, document where it sits on that spectrum; when you implement one, honor it.

4. **Event shape is wire-visible.** Changes to stream-part → event mapping, tool lifecycle events, or the SSE envelope affect both the server and the SSE client (`formatSSEEvent`). Update producers, consumers, and `__tests__/` together.

5. **New metadata flags land in shared code.** `context.metadata.__autoContinue` / `__continuationPrompt` are the prior art — the pattern is: tools mutate metadata, the loop's `getAutoContinuation` picks it up.

6. **Tests live next to the module, not in the transport.** `packages/ai-transport/src/__tests__/` covers the extracted behavior with direct unit tests. The SSE adapter's tests verify wiring (the callbacks are connected correctly), not the behavior itself.

## Reviewer checklist — red flags

- Behavior inlined into `MessageExecutionService.ts` that belongs behind a callback on the loop/processor.
- Transport-specific branching inside this package.
- New hook added without a JSDoc error-contract note.
- Shared-behavior change landing without a test in `__tests__/`.

## The client side-effect home

On the client, `app/src/hooks/shared/` (`completionSideEffects.ts`, `toolMappers.ts`, `toolSideEffects.ts`) holds the side-effect logic for the SSE chat hook (`app/src/hooks/useSSEChat.ts`). The client WebSocket transport was removed in AIROBUILD-2629, so there is a single chat path; keep cross-cutting chat behavior in `hooks/shared/` rather than inlining it into the hook.

## Commands

```bash
pnpm --filter @airo/ai-transport typecheck     # Type check
pnpm --filter @airo/ai-transport build         # Build
pnpm --filter @airo/ai-transport test          # Tests
```

See [`README.md`](./README.md) for the event-channel architecture diagrams.
