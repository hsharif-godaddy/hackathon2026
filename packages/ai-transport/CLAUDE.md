# @airo/ai-transport

Transport-agnostic infrastructure shared by the WebSocket and SSE servers. The two transports (`experimental-websocket-server.ts` + `agents/src/server/sse/MessageExecutionService.ts`) are adapters — the behavior lives here.

**If a change applies to both transports, it belongs in this package.** Adding it to one transport and not the other is a bug, even when the tests still pass.

## What lives here

| Module | Responsibility |
| --- | --- |
| `agent-execution-loop.ts` | Handoff + auto-continuation loop. Transport-agnostic via callbacks. |
| `stream-part-processor.ts` | AI SDK stream-part → tool/text lifecycle events. |
| `conversation-event-channel.ts` | Pub/sub event channel with per-conversation circular buffer for replay. |
| `subscribers/` | `WebSocketSubscriber`, `SSESubscriber`, `PersistenceSubscriber`, `APMSubscriber`, `EventCoalescer`. |
| `connection-state-manager.ts`, `connection-recovery-manager.ts` | Connection lifecycle + recovery. |
| `client-action-registry.ts` | Client-side action dispatch shared by both transports. |
| `sse-format.ts`, `sse-writer.ts` | SSE wire format — also consumed by the SSE client. |
| `coalesce-events.ts`, `chunk-timeout-guard.ts`, `stream-timing-tracker.ts` | Shared utilities. |

## Rules

1. **Transport servers wire callbacks, they don't branch on transport.** No `if (transport === 'sse')` inside this package. If you reach for one, invert: add a callback to the existing interface.

2. **Shared behavior goes behind an existing callback interface.** `AgentExecutionLoopCallbacks`, `PartProcessorCallbacks`, and the subscriber interfaces are the seams. Extend them rather than duplicating logic in each transport.

3. **Respect the documented error contracts.** `AgentExecutionLoopCallbacks` and `PartProcessorCallbacks` have JSDoc that spells out which hooks may throw (fatal — propagates and aborts the turn) and which must not (additive — implementor wraps in try/catch). When you add a hook, document where it sits on that spectrum; when you implement one, honor it.

4. **Event shape is wire-visible.** Changes to stream-part → event mapping, tool lifecycle events, or the SSE envelope affect both the server and the SSE client (`formatSSEEvent`). Update producers, consumers, and `__tests__/` together.

5. **New metadata flags land in shared code.** `context.metadata.__autoContinue` / `__continuationPrompt` are the prior art — the pattern is: tools mutate metadata, the loop's `getAutoContinuation` picks it up. Don't introduce a metadata channel that only one transport reads.

6. **Tests live next to the module, not in the transport.** `packages/ai-transport/src/__tests__/` covers the extracted behavior with direct unit tests. Transport-level tests verify wiring (the callbacks are connected correctly), not the behavior itself.

## Reviewer checklist — red flags

- Logic duplicated in `experimental-websocket-server.ts` and `MessageExecutionService.ts`. Lift into a callback on the loop/processor.
- Transport-specific branching inside this package.
- Tool-lifecycle or event-shape change made in only one transport.
- New `__*` metadata flag read by only one transport.
- New hook added without a JSDoc error-contract note.
- Shared-behavior change landing without a test in `__tests__/`.

## The client has the same split

On the client, `app/src/hooks/shared/` (`completionSideEffects.ts`, `toolMappers.ts`, `toolSideEffects.ts`) plays the same role for the WS and SSE handlers. The same rule applies there: behavior common to both transports goes in `hooks/shared/`, not duplicated into each handler.

## Commands

```bash
pnpm --filter @airo/ai-transport typecheck     # Type check
pnpm --filter @airo/ai-transport build         # Build
pnpm --filter @airo/ai-transport test          # Tests
```

See [`README.md`](./README.md) for the event-channel architecture diagrams.
