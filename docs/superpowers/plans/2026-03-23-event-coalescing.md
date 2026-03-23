# WebSocket Event Coalescing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce WebSocket event frequency by coalescing consecutive same-type streaming events (chunk, tool_input_delta) on the server side, with adaptive window sizing based on client backpressure.

**Architecture:** Content coalescing inside `WebSocketSubscriber` — buffer consecutive same-type events in a timer-based window, flush as a single standard `message` emit with concatenated content. No new event names, no client changes. Recovery replay applies the same coalescing. Adaptive window widens when Socket.IO write buffer grows (client falling behind). Complementary to the existing client-side RAF buffering which handles render-rate coalescing.

**Tech Stack:** TypeScript, Socket.IO (Engine.IO internals for backpressure signal), Vitest

**Design note — backpressure sampling:** The `getBackpressure` function is called when the flush timer is _scheduled_ (on first push after a flush), not when the timer fires. If backpressure drops between scheduling and firing, the wider window still applies. This is acceptable — it errs on the side of more coalescing when pressure was recently high.

---

## Chunk 1: Core Coalescing Logic

### File Structure

| Action | File                                                                           | Responsibility                                                     |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Create | `packages/ai-transport/src/subscribers/event-coalescer.ts`                     | Pure coalescing logic: buffer, merge, flush timer, adaptive window |
| Create | `packages/ai-transport/src/subscribers/__tests__/event-coalescer.test.ts`      | Unit tests for coalescer                                           |
| Modify | `packages/ai-transport/src/subscribers/websocket-subscriber.ts`                | Integrate coalescer into onEvent/dispose                           |
| Modify | `packages/ai-transport/src/subscribers/__tests__/websocket-subscriber.test.ts` | Update tests for coalescing behavior                               |
| Modify | `packages/ai-transport/src/index.ts`                                           | Export new types                                                   |

### Task 1: Create EventCoalescer with tests

The coalescer is a pure utility with no Socket.IO dependency. It accepts events, buffers coalesceable ones, and calls a flush callback. This keeps it testable without mocking sockets.

**Design decisions:**

- Only `chunk` and `tool_input_delta` are coalesceable (content is string-concatenable, semantically identical when merged)
- All other event types trigger an immediate flush of any pending buffer, then pass through directly
- The coalesced message uses the **last** event's `data` (including sequence), preserving the most recent metadata
- Content is concatenated: `"He" + "llo"` → `"Hello"`
- A `type change` also triggers flush: buffered `chunk` events flush when a `tool_input_delta` arrives
- `flush()` method flushes without disabling the coalescer (for `onError`); `dispose()` flushes AND permanently disables

**Files:**

- Create: `packages/ai-transport/src/subscribers/event-coalescer.ts`
- Create: `packages/ai-transport/src/subscribers/__tests__/event-coalescer.test.ts`

- [ ] **Step 1: Write failing tests for EventCoalescer**

```typescript
// packages/ai-transport/src/subscribers/__tests__/event-coalescer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EventCoalescer,
  type CoalescerConfig,
  type CoalescedMessage,
} from "../event-coalescer.js";
import type { WebSocketMessage } from "../websocket-subscriber.js";

function msg(
  type: string,
  content: string,
  data: Record<string, unknown> = {},
): WebSocketMessage {
  return { type: type as any, content, data };
}

describe("EventCoalescer", () => {
  let flushed: CoalescedMessage[][];
  let flushFn: (messages: CoalescedMessage[]) => void;
  let coalescer: EventCoalescer;

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
    flushFn = (msgs) => flushed.push([...msgs]);
    coalescer = new EventCoalescer(flushFn, { baseWindowMs: 30 });
  });

  afterEach(() => {
    coalescer.dispose();
    vi.useRealTimers();
  });

  describe("coalesceable events", () => {
    it("buffers consecutive chunk events and flushes on timer", () => {
      coalescer.push(msg("chunk", "He"));
      coalescer.push(msg("chunk", "llo"));
      coalescer.push(msg("chunk", " world"));

      expect(flushed).toHaveLength(0);

      vi.advanceTimersByTime(30);

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(1);
      expect(flushed[0][0].content).toBe("Hello world");
      expect(flushed[0][0].type).toBe("chunk");
    });

    it("buffers consecutive tool_input_delta events", () => {
      coalescer.push(msg("tool_input_delta", '{"na'));
      coalescer.push(msg("tool_input_delta", 'me":'));
      coalescer.push(msg("tool_input_delta", '"foo"}'));

      vi.advanceTimersByTime(30);

      expect(flushed).toHaveLength(1);
      expect(flushed[0][0].content).toBe('{"name":"foo"}');
    });

    it("uses last event data for coalesced message", () => {
      coalescer.push(msg("chunk", "a", { sequence: 1 }));
      coalescer.push(msg("chunk", "b", { sequence: 2 }));
      coalescer.push(msg("chunk", "c", { sequence: 3 }));

      vi.advanceTimersByTime(30);

      expect(flushed[0][0].data).toEqual({ sequence: 3 });
    });

    it("sets coalescedCount when multiple events merged", () => {
      coalescer.push(msg("chunk", "a"));
      coalescer.push(msg("chunk", "b"));
      coalescer.push(msg("chunk", "c"));

      vi.advanceTimersByTime(30);

      expect(flushed[0][0].coalescedCount).toBe(3);
    });

    it("omits coalescedCount for single event", () => {
      coalescer.push(msg("chunk", "solo"));

      vi.advanceTimersByTime(30);

      expect(flushed[0][0].coalescedCount).toBeUndefined();
    });

    it("coalesces chunks with empty content strings", () => {
      coalescer.push(msg("chunk", ""));
      coalescer.push(msg("chunk", "hello"));
      coalescer.push(msg("chunk", ""));

      vi.advanceTimersByTime(30);

      expect(flushed[0][0].content).toBe("hello");
    });
  });

  describe("non-coalesceable events", () => {
    it("flushes pending buffer then passes through immediately", () => {
      coalescer.push(msg("chunk", "Hello"));
      coalescer.push(msg("tool_start", "", { toolId: "t1" }));

      // chunk flushed immediately due to type change, tool_start passed through
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(2);
      expect(flushed[0][0].content).toBe("Hello");
      expect(flushed[0][1].type).toBe("tool_start");
    });

    it("passes lifecycle events through without delay", () => {
      coalescer.push(msg("step_start", "", { step: 1 }));

      expect(flushed).toHaveLength(1);
      expect(flushed[0][0].type).toBe("step_start");
    });
  });

  describe("terminal events", () => {
    it("flushes buffer and passes complete event immediately", () => {
      coalescer.push(msg("chunk", "final text"));
      coalescer.push(msg("complete", "", { usage: {} }));

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(2);
      expect(flushed[0][0].content).toBe("final text");
      expect(flushed[0][1].type).toBe("complete");
    });

    it("flushes buffer and passes error event immediately", () => {
      coalescer.push(msg("chunk", "partial"));
      coalescer.push(msg("error", "something broke", { error: "fail" }));

      expect(flushed).toHaveLength(1);
      expect(flushed[0][0].content).toBe("partial");
      expect(flushed[0][1].type).toBe("error");
    });
  });

  describe("type change within coalesceable types", () => {
    it("flushes chunk buffer when tool_input_delta arrives", () => {
      coalescer.push(msg("chunk", "text"));
      coalescer.push(msg("tool_input_delta", '{"a'));

      // chunk flushed due to type change
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toHaveLength(1);
      expect(flushed[0][0].content).toBe("text");

      // tool_input_delta now buffered
      vi.advanceTimersByTime(30);
      expect(flushed).toHaveLength(2);
      expect(flushed[1][0].content).toBe('{"a');
    });
  });

  describe("flush", () => {
    it("flushes pending buffer without disabling the coalescer", () => {
      coalescer.push(msg("chunk", "first"));
      coalescer.flush();

      expect(flushed).toHaveLength(1);
      expect(flushed[0][0].content).toBe("first");

      // Coalescer still works after flush
      coalescer.push(msg("chunk", "second"));
      vi.advanceTimersByTime(30);

      expect(flushed).toHaveLength(2);
      expect(flushed[1][0].content).toBe("second");
    });

    it("is a no-op when buffer is empty", () => {
      coalescer.flush();
      expect(flushed).toHaveLength(0);
    });
  });

  describe("dispose", () => {
    it("flushes pending buffer on dispose", () => {
      coalescer.push(msg("chunk", "unflushed"));
      coalescer.dispose();

      expect(flushed).toHaveLength(1);
      expect(flushed[0][0].content).toBe("unflushed");
    });

    it("clears timer on dispose", () => {
      coalescer.push(msg("chunk", "data"));
      coalescer.dispose();
      flushed.length = 0;

      vi.advanceTimersByTime(100);
      expect(flushed).toHaveLength(0); // no double flush
    });

    it("silently drops events pushed after dispose", () => {
      coalescer.dispose();
      coalescer.push(msg("chunk", "after dispose"));

      vi.advanceTimersByTime(100);
      expect(flushed).toHaveLength(0);
    });
  });

  describe("adaptive window", () => {
    it("uses backpressure function to widen window", () => {
      const backpressure = vi.fn().mockReturnValue(55);
      const adaptive = new EventCoalescer(flushFn, {
        baseWindowMs: 30,
        getBackpressure: backpressure,
      });

      adaptive.push(msg("chunk", "a"));
      vi.advanceTimersByTime(30);
      expect(flushed).toHaveLength(0); // window widened due to backpressure > 50

      vi.advanceTimersByTime(70); // 30 + 70 = 100ms total
      expect(flushed).toHaveLength(1);

      adaptive.dispose();
    });

    it("uses base window when backpressure is low", () => {
      const backpressure = vi.fn().mockReturnValue(5);
      const adaptive = new EventCoalescer(flushFn, {
        baseWindowMs: 30,
        getBackpressure: backpressure,
      });

      adaptive.push(msg("chunk", "a"));
      vi.advanceTimersByTime(30);
      expect(flushed).toHaveLength(1);

      adaptive.dispose();
    });
  });

  describe("single event passthrough", () => {
    it("single coalesceable event flushes on timer", () => {
      coalescer.push(msg("chunk", "solo"));
      vi.advanceTimersByTime(30);

      expect(flushed).toHaveLength(1);
      expect(flushed[0][0].content).toBe("solo");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/ai-transport test -- subscribers/__tests__/event-coalescer`
Expected: FAIL — module not found

- [ ] **Step 3: Implement EventCoalescer**

```typescript
// packages/ai-transport/src/subscribers/event-coalescer.ts
import type { StreamingEventType } from "../interfaces.js";
import type { WebSocketMessage } from "./websocket-subscriber.js";

/**
 * Message with coalescing metadata
 */
export interface CoalescedMessage extends WebSocketMessage {
  /** Number of original events merged into this message (1 = no coalescing) */
  coalescedCount?: number;
}

/**
 * Configuration for EventCoalescer
 */
export interface CoalescerConfig {
  /** Base coalescing window in ms (default: 30) */
  baseWindowMs?: number;
  /** Returns current backpressure level (e.g. Socket.IO writeBuffer length).
   *  Higher values widen the coalescing window.
   *  Sampled when the flush timer is scheduled (on first push after a flush),
   *  not when the timer fires. */
  getBackpressure?: () => number;
}

/** Event types whose content can be concatenated */
const COALESCEABLE_TYPES: ReadonlySet<string> = new Set([
  "chunk",
  "tool_input_delta",
]);

/**
 * Pure coalescing logic for WebSocket messages.
 *
 * Buffers consecutive same-type coalesceable events (chunk, tool_input_delta)
 * and flushes them as a single message with concatenated content on a timer.
 * Non-coalesceable events flush any pending buffer and pass through immediately.
 *
 * Adaptive window: if getBackpressure returns > 0, the flush window scales up
 * to reduce emit frequency when the client is falling behind.
 */
export class EventCoalescer {
  private pending: WebSocketMessage | null = null;
  private pendingCount = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly onFlush: (messages: CoalescedMessage[]) => void;
  private readonly baseWindowMs: number;
  private readonly getBackpressure: (() => number) | undefined;

  constructor(
    onFlush: (messages: CoalescedMessage[]) => void,
    config: CoalescerConfig = {},
  ) {
    this.onFlush = onFlush;
    this.baseWindowMs = config.baseWindowMs ?? 30;
    this.getBackpressure = config.getBackpressure;
  }

  /**
   * Accept an event for potential coalescing
   */
  push(message: WebSocketMessage): void {
    if (this.disposed) return;

    const isCoalesceable = COALESCEABLE_TYPES.has(message.type);

    if (!isCoalesceable) {
      // Non-coalesceable: flush pending + pass through immediately together
      const batch: CoalescedMessage[] = [];
      if (this.pending) {
        batch.push(this.takePending());
      }
      batch.push(message);
      this.clearTimer();
      this.onFlush(batch);
      return;
    }

    // Coalesceable event
    if (this.pending && this.pending.type === message.type) {
      // Same type: merge content
      this.pending.content += message.content;
      this.pending.data = message.data;
      this.pendingCount++;
    } else {
      // Different coalesceable type: flush previous, start new buffer
      if (this.pending) {
        this.clearTimer();
        this.onFlush([this.takePending()]);
      }
      this.pending = { ...message };
      this.pendingCount = 1;
    }

    this.scheduleFlush();
  }

  /**
   * Immediately flush any pending buffer without disabling the coalescer.
   * Use this for non-terminal flush points (e.g. onError where streaming may continue).
   */
  flush(): void {
    this.clearTimer();
    if (this.pending) {
      this.onFlush([this.takePending()]);
    }
  }

  /**
   * Immediately flush any pending buffer and permanently disable the coalescer.
   * MUST be called on socket disconnect to avoid leaking timers.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    if (this.pending) {
      this.onFlush([this.takePending()]);
    }
  }

  private takePending(): CoalescedMessage {
    const msg = this.pending!;
    const count = this.pendingCount;
    this.pending = null;
    this.pendingCount = 0;
    return count > 1 ? { ...msg, coalescedCount: count } : msg;
  }

  private getWindowMs(): number {
    if (!this.getBackpressure) return this.baseWindowMs;
    const backlog = this.getBackpressure();
    if (backlog > 50) return 100;
    if (backlog > 20) return 60;
    return this.baseWindowMs;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return; // already scheduled
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.pending) {
        this.onFlush([this.takePending()]);
      }
    }, this.getWindowMs());
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/ai-transport test -- subscribers/__tests__/event-coalescer`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/subscribers/event-coalescer.ts packages/ai-transport/src/subscribers/__tests__/event-coalescer.test.ts
git commit -m "feat(ai-transport): add EventCoalescer for batching WebSocket events

Pure coalescing utility that buffers consecutive same-type events
(chunk, tool_input_delta) and flushes on a timer. Adaptive window
widens under client backpressure. No Socket.IO dependency — testable
with plain callbacks."
```

### Task 2: Integrate EventCoalescer into WebSocketSubscriber

**Files:**

- Modify: `packages/ai-transport/src/subscribers/websocket-subscriber.ts`
- Modify: `packages/ai-transport/src/subscribers/__tests__/websocket-subscriber.test.ts`

**Important — existing test compatibility:** The existing tests at lines 68-84 and 249-271 send `chunk` events and expect immediate emit. After coalescing, `chunk` events are buffered. We must:

1. Add `vi.useFakeTimers()` / `vi.useRealTimers()` to the **outer** `beforeEach`/`afterEach`
2. Add `subscriber.dispose()` to the outer `afterEach` to prevent timer leaks
3. Change the existing test at line 68 to use `tool_result` (non-coalesceable) since it tests message format, not coalescing
4. Update the integration test at line 249 to advance timers after `onEvent` calls

- [ ] **Step 1: Update existing tests for coalescing compatibility + add new coalescing tests**

Full updated test file for `websocket-subscriber.test.ts`:

Key changes to existing tests:

- Outer `beforeEach` adds `vi.useFakeTimers()`
- Outer `afterEach` adds `subscriber.dispose()` and `vi.useRealTimers()`
- `'emits to connected socket'` test: changed from `chunk` to `tool_result` (non-coalesceable, tests message format not coalescing)
- `'skips events during disconnection, resumes after reconnection'` test: add `vi.advanceTimersByTime(30)` after sending the post-reconnection chunk event

New `describe('event coalescing')` block added at end with dedicated coalescing tests.

```typescript
// Changes to packages/ai-transport/src/subscribers/__tests__/websocket-subscriber.test.ts

// 1. Add to outer beforeEach (after line 57):
//    vi.useFakeTimers()

// 2. Add outer afterEach block (after beforeEach):
//    afterEach(() => {
//      subscriber.dispose()
//      vi.useRealTimers()
//    })

// 3. Change test at line 68 'emits to connected socket':
//    Change type from 'chunk' to 'tool_result' (non-coalesceable, immediate emit)

// 4. In integration test 'skips events during disconnection, resumes after reconnection' (line 249):
//    After line 268: await subscriber.onEvent(createTestEvent({ content: 'Event 4' }))
//    Add: vi.advanceTimersByTime(30)
//    Then the existing assertion at line 269 will pass

// 5. Add new describe block at end:
describe("event coalescing", () => {
  it("coalesces consecutive chunk events into single emit", async () => {
    await subscriber.onEvent(
      createTestEvent({ type: "chunk", content: "He", sequence: 1 }),
    );
    await subscriber.onEvent(
      createTestEvent({ type: "chunk", content: "llo", sequence: 2 }),
    );
    await subscriber.onEvent(
      createTestEvent({ type: "chunk", content: " world", sequence: 3 }),
    );

    expect(socket.emittedEvents).toHaveLength(0);

    vi.advanceTimersByTime(30);

    expect(socket.emittedEvents).toHaveLength(1);
    expect(socket.emittedEvents[0].data.content).toBe("Hello world");
  });

  it("flushes immediately on complete event", async () => {
    await subscriber.onEvent(
      createTestEvent({ type: "chunk", content: "final", sequence: 1 }),
    );
    await subscriber.onEvent(
      createTestEvent({
        type: "complete",
        content: "",
        sequence: 2,
        data: { usage: {} },
      }),
    );

    expect(socket.emittedEvents).toHaveLength(2);
    expect(socket.emittedEvents[0].data.content).toBe("final");
    expect(socket.emittedEvents[1].data.type).toBe("complete");
  });

  it("flushes pending buffer on dispose", async () => {
    await subscriber.onEvent(
      createTestEvent({ type: "chunk", content: "pending", sequence: 1 }),
    );
    subscriber.dispose();

    expect(socket.emittedEvents).toHaveLength(1);
    expect(socket.emittedEvents[0].data.content).toBe("pending");
  });

  it("non-coalesceable events pass through immediately", async () => {
    await subscriber.onEvent(
      createTestEvent({ type: "tool_start", content: "", sequence: 1 }),
    );

    expect(socket.emittedEvents).toHaveLength(1);
    expect(socket.emittedEvents[0].data.type).toBe("tool_start");
  });
});
```

- [ ] **Step 2: Run tests to verify coalescing tests fail (existing tests should still pass with format changes)**

Run: `pnpm --filter @airo/ai-transport test -- subscribers/__tests__/websocket-subscriber`
Expected: New coalescing tests FAIL, existing tests pass after format adjustments

- [ ] **Step 3: Update WebSocketSubscriber to use EventCoalescer**

Modify `packages/ai-transport/src/subscribers/websocket-subscriber.ts`:

Key changes:

1. Constructor creates an `EventCoalescer` that calls `socket.emit('message', msg)` on flush
2. `onEvent()` delegates to coalescer instead of emitting directly
3. Add `dispose()` method that calls `coalescer.dispose()`
4. `onError()` calls `coalescer.flush()` (not dispose — coalescer remains usable)
5. Accept optional `CoalescerConfig` in constructor for adaptive backpressure
6. Keep `blocking = true` — `onEvent` returns immediately after buffering (synchronous)

```typescript
import type { EventSubscriber, StreamingEvent } from "../interfaces.js";
import {
  EventCoalescer,
  type CoalescerConfig,
  type CoalescedMessage,
} from "./event-coalescer.js";

export interface WebSocketMessage {
  type: StreamingEvent["type"];
  content: string;
  data: Record<string, unknown>;
}

export type IsDisconnectedFn = (socketId: string) => boolean;

export class WebSocketSubscriber implements EventSubscriber {
  id: string;
  blocking = true;

  private socket: any;
  private isDisconnected: IsDisconnectedFn;
  private coalescer: EventCoalescer;

  constructor(
    socket: any,
    isDisconnected: IsDisconnectedFn,
    coalescerConfig?: CoalescerConfig,
  ) {
    this.socket = socket;
    this.isDisconnected = isDisconnected;
    this.id = `websocket-${socket.id}`;

    this.coalescer = new EventCoalescer(
      (messages) => this.emitMessages(messages),
      coalescerConfig,
    );
  }

  async onEvent(event: StreamingEvent): Promise<void> {
    if (this.isDisconnected(this.socket.id)) {
      return;
    }

    if (this.socket.connected) {
      const message = this.toWebSocketMessage(event);
      this.coalescer.push(message);
    }
  }

  /**
   * Flush pending buffer and release timer resources.
   * MUST be called on socket disconnect to avoid leaking buffered events.
   */
  dispose(): void {
    this.coalescer.dispose();
  }

  onError(error: Error): void {
    if (this.socket.connected) {
      // Flush pending events before emitting error (non-terminal — coalescer stays usable)
      this.coalescer.flush();
      this.socket.emit("message", {
        type: "error",
        content: error.message,
        data: {
          error: error.message,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  filter(_event: StreamingEvent): boolean {
    return true;
  }

  toWebSocketMessage(event: StreamingEvent): WebSocketMessage {
    return {
      type: event.type,
      content: event.content,
      data: event.data,
    };
  }

  private emitMessages(messages: CoalescedMessage[]): void {
    if (!this.socket.connected) return;
    for (const msg of messages) {
      this.socket.emit("message", msg);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/ai-transport test -- subscribers/__tests__/websocket-subscriber`
Expected: All tests PASS (both old and new)

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/subscribers/websocket-subscriber.ts packages/ai-transport/src/subscribers/__tests__/websocket-subscriber.test.ts
git commit -m "feat(ai-transport): integrate EventCoalescer into WebSocketSubscriber

WebSocketSubscriber now buffers consecutive chunk/tool_input_delta
events and flushes on a 30ms timer. Non-coalesceable and terminal
events flush immediately. Same 'message' event format — fully
backwards compatible with existing clients."
```

### Task 3: Wire backpressure signal and dispose on disconnect

There are **4 call sites** for `new WebSocketSubscriber` in `experimental-websocket-server.ts`. All need the backpressure config. The subscriber reference must be stored on `socket.data` for dispose on disconnect.

**Call sites:**

1. Line ~716: `createWebSocketSubscriber` callback for manual recovery
2. Line ~818: `createWebSocketSubscriber` callback for conversation recovery
3. Line ~873: `createWebSocketSubscriber` callback for initial recovery
4. Line ~1863: Fresh connection subscriber creation (inline)

**Files:**

- Modify: `packages/ai-transport/src/experimental-websocket-server.ts`
- Modify: `packages/ai-transport/src/index.ts` (export new types)

- [ ] **Step 1: Create a helper method for subscriber creation**

Add a private method to the WebSocket server class to avoid duplicating the backpressure config across all 4 call sites:

```typescript
private createWebSocketSubscriber(socket: Socket): WebSocketSubscriber {
  const subscriber = new WebSocketSubscriber(
    socket,
    (id) => this.stateManager.isDisconnected(id),
    {
      getBackpressure: () => (socket as any).conn?.writeBuffer?.length ?? 0
    }
  )
  // Store reference for dispose on disconnect
  ;(socket as any).data = (socket as any).data || {}
  ;(socket as any).data.wsSubscriber = subscriber
  return subscriber
}
```

- [ ] **Step 2: Update all 4 call sites to use the helper**

Replace all `new WebSocketSubscriber(sock, (id) => this.stateManager.isDisconnected(id))` with `this.createWebSocketSubscriber(sock)`.

At lines ~716, ~818, ~873:

```typescript
createWebSocketSubscriber: (sock) => this.createWebSocketSubscriber(sock);
```

At line ~1863:

```typescript
this.eventChannel.subscribe(
  conversationId,
  this.createWebSocketSubscriber(socket),
);
```

- [ ] **Step 3: Add dispose() call in disconnect handler**

In the `socket.on('disconnect', ...)` handler at line ~564, add disposal before cleanup:

```typescript
socket.on("disconnect", async (reason) => {
  // Flush any coalesced events before cleanup
  const wsSubscriber = (socket as any).data?.wsSubscriber as
    | WebSocketSubscriber
    | undefined;
  if (wsSubscriber) {
    wsSubscriber.dispose();
  }

  // ... existing disconnect logic
});
```

**Note:** `dispose()` calls `emitMessages()` which checks `socket.connected`. During the disconnect event, Socket.IO may still allow writes briefly. If the socket is already closed, `emitMessages` returns early (no-op). Either way, the timer is cleaned up and no events leak.

- [ ] **Step 4: Export new types from index.ts**

Add to `packages/ai-transport/src/index.ts`:

```typescript
export type {
  CoalescerConfig,
  CoalescedMessage,
} from "./subscribers/event-coalescer.js";
export { EventCoalescer } from "./subscribers/event-coalescer.js";
```

- [ ] **Step 5: Run full test suite**

Run: `pnpm --filter @airo/ai-transport test`
Expected: All tests PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @airo/ai-transport typecheck`
Expected: No type errors (the optional third constructor parameter is backwards compatible)

- [ ] **Step 7: Commit**

```bash
git add packages/ai-transport/src/experimental-websocket-server.ts packages/ai-transport/src/index.ts
git commit -m "feat(ai-transport): wire backpressure signal and dispose on disconnect

Pass Socket.IO writeBuffer length as backpressure signal to coalescer.
Coalescing window widens from 30ms to 100ms when client falls behind.
Dispose called on disconnect to flush pending events. Helper method
centralizes subscriber creation across all 4 call sites."
```

---

## Chunk 2: Recovery Replay Coalescing

### Task 4: Add coalesceEvents utility for recovery replay

Recovery replay sends individual events from the circular buffer. We need to coalesce consecutive same-type events before replaying, so the client sees the same delivery pattern as live streaming. The `bufferedEventCount` in `recovery_status` must reflect the coalesced count.

**Files:**

- Create: `packages/ai-transport/src/coalesce-events.ts`
- Create: `packages/ai-transport/src/__tests__/coalesce-events.test.ts`

- [ ] **Step 1: Write failing tests for coalesceEvents**

```typescript
// packages/ai-transport/src/__tests__/coalesce-events.test.ts
import { describe, it, expect } from "vitest";
import { coalesceEvents } from "../coalesce-events.js";
import type { StreamingEvent } from "../interfaces.js";

function event(
  type: string,
  content: string,
  sequence: number,
): StreamingEvent {
  return {
    id: `evt-${sequence}`,
    conversationId: "conv-1",
    sequence,
    type: type as any,
    content,
    data: { sequence },
    timestamp: new Date(),
    agentName: "test",
  };
}

describe("coalesceEvents", () => {
  it("coalesces consecutive chunk events", () => {
    const events = [
      event("chunk", "He", 1),
      event("chunk", "llo", 2),
      event("chunk", " world", 3),
    ];

    const result = coalesceEvents(events);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hello world");
    expect(result[0].data.sequence).toBe(3); // last sequence
  });

  it("does not coalesce non-coalesceable events", () => {
    const events = [
      event("tool_start", "", 1),
      event("tool_call", "{}", 2),
      event("tool_result", "ok", 3),
    ];

    const result = coalesceEvents(events);
    expect(result).toHaveLength(3);
  });

  it("coalesces within type boundaries only", () => {
    const events = [
      event("chunk", "a", 1),
      event("chunk", "b", 2),
      event("tool_start", "", 3),
      event("tool_input_delta", '{"x', 4),
      event("tool_input_delta", '":1}', 5),
      event("tool_call", '{"x":1}', 6),
      event("chunk", "c", 7),
      event("chunk", "d", 8),
    ];

    const result = coalesceEvents(events);

    expect(result).toHaveLength(5);
    expect(result[0].content).toBe("ab");
    expect(result[1].type).toBe("tool_start");
    expect(result[2].content).toBe('{"x":1}');
    expect(result[2].type).toBe("tool_input_delta");
    expect(result[3].type).toBe("tool_call");
    expect(result[4].content).toBe("cd");
  });

  it("returns empty array for empty input", () => {
    expect(coalesceEvents([])).toEqual([]);
  });

  it("handles single event", () => {
    const result = coalesceEvents([event("chunk", "solo", 1)]);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("solo");
  });

  it("handles empty content strings in coalesceable events", () => {
    const events = [
      event("chunk", "", 1),
      event("chunk", "hello", 2),
      event("chunk", "", 3),
    ];

    const result = coalesceEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @airo/ai-transport test -- __tests__/coalesce-events`
Expected: FAIL — module not found

- [ ] **Step 3: Implement coalesceEvents**

```typescript
// packages/ai-transport/src/coalesce-events.ts
import type { StreamingEvent } from "./interfaces.js";

const COALESCEABLE_TYPES: ReadonlySet<string> = new Set([
  "chunk",
  "tool_input_delta",
]);

/**
 * Coalesce consecutive same-type coalesceable events in an array.
 * Used for recovery replay so the client sees the same delivery pattern
 * as live streaming with coalescing enabled.
 *
 * Non-coalesceable events pass through unchanged.
 * Coalesced events use the last event's data/sequence/metadata.
 */
export function coalesceEvents(events: StreamingEvent[]): StreamingEvent[] {
  if (events.length === 0) return [];

  const result: StreamingEvent[] = [];
  let pending: StreamingEvent | null = null;

  for (const event of events) {
    if (!COALESCEABLE_TYPES.has(event.type)) {
      // Flush pending, then pass through
      if (pending) {
        result.push(pending);
        pending = null;
      }
      result.push(event);
      continue;
    }

    if (pending && pending.type === event.type) {
      // Merge: concatenate content, keep last event's metadata
      pending = {
        ...event,
        content: pending.content + event.content,
      };
    } else {
      // Different coalesceable type or first event
      if (pending) {
        result.push(pending);
      }
      pending = { ...event };
    }
  }

  if (pending) {
    result.push(pending);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/ai-transport test -- __tests__/coalesce-events`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai-transport/src/coalesce-events.ts packages/ai-transport/src/__tests__/coalesce-events.test.ts
git commit -m "feat(ai-transport): add coalesceEvents utility for recovery replay

Static function that coalesces consecutive same-type coalesceable
events in an array. Used before replaying buffered events so recovery
matches live streaming delivery pattern."
```

### Task 5: Integrate coalesceEvents into recovery replay

Apply coalescing to the replay paths in `connection-recovery-manager.ts`:

1. Main replay loop (`executeRecoveryFlow`, search for `eventsToReplay` replay loop)
2. Catch-up handshake (`beginCatchUpHandshake` method)
3. ACK timeout calculation (`setupRecoveryAckHandling`)

All event counts must use coalesced length for consistency.

**Files:**

- Modify: `packages/ai-transport/src/connection-recovery-manager.ts`
- Modify: `packages/ai-transport/src/index.ts` (export coalesceEvents)

- [ ] **Step 1: Update `executeRecoveryFlow` to coalesce before replay**

In `connection-recovery-manager.ts`, import `coalesceEvents`:

```typescript
import { coalesceEvents } from "./coalesce-events.js";
```

In `executeRecoveryFlow` (search for `eventsToReplay`), add coalescing before the replay loop and update all counts:

```typescript
// After eventsToReplay is computed:
const coalescedReplay = coalesceEvents(eventsToReplay)

// Update recovery_status message:
bufferedEventCount: coalescedReplay.length,  // was eventsToReplay.length

// Replace replay loop:
for (const event of coalescedReplay) {
  socket.volatile.emit('message', {
    type: event.type,
    content: event.content,
    data: { ...event.data, sequence: event.sequence }
  } as WebSocketMessage)
}

// Update replay_complete:
eventsReplayed: coalescedReplay.length  // was eventsToReplay.length

// Pass coalescedReplay to setupRecoveryAckHandling (not eventsToReplay):
await this.setupRecoveryAckHandling(
  socket,
  context,
  preReplaySequence,
  coalescedReplay,  // coalesced array — timeout and counts are consistent
  callbacks
)
```

- [ ] **Step 2: Update `beginCatchUpHandshake` to coalesce internally**

The catch-up handshake receives raw events from `getEventsSince()`. Coalesce them before emitting:

```typescript
beginCatchUpHandshake(
  socket: Socket,
  params: { conversationId: string; events: StreamingEvent[]; onComplete: ...; onTimeout: ... }
): void {
  const { conversationId, events, onComplete, onTimeout } = params

  // Coalesce catch-up events for consistent delivery
  const coalescedEvents = coalesceEvents(events)
  const finalSequence = events[events.length - 1]!.sequence  // use original last sequence

  // Send catchup status with coalesced count
  socket.emit('message', {
    type: 'catchup_status',
    content: 'Delivering queued events',
    data: {
      conversationId,
      pendingCount: coalescedEvents.length,  // was events.length
      lastSequence: finalSequence,
      requiresAck: true
    }
  } as WebSocketMessage)

  // Replay coalesced catch-up events
  for (const event of coalescedEvents) {
    socket.volatile.emit('message', {
      type: event.type,
      content: event.content,
      data: { ...event.data, sequence: event.sequence }
    } as WebSocketMessage)
  }

  // Send catchup complete with coalesced count
  socket.emit('message', {
    type: 'catchup_complete',
    content: 'Catch-up events sent',
    data: {
      conversationId,
      eventsReplayed: coalescedEvents.length,  // was events.length
      lastSequence: finalSequence
    }
  } as WebSocketMessage)

  // ... rest of ACK handling unchanged
}
```

- [ ] **Step 3: Export coalesceEvents from index.ts**

```typescript
export { coalesceEvents } from "./coalesce-events.js";
```

- [ ] **Step 4: Run full test suite**

Run: `pnpm --filter @airo/ai-transport test`
Expected: All tests PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @airo/ai-transport typecheck`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add packages/ai-transport/src/connection-recovery-manager.ts packages/ai-transport/src/index.ts
git commit -m "feat(ai-transport): coalesce events during recovery replay

Apply same coalescing to recovery replay and catch-up handshake.
Clients see consistent delivery pattern whether live or recovering.
Event counts in recovery_status/replay_complete/catchup_status all
reflect coalesced count. ACK timeout scales with coalesced count."
```

### Task 6: Final verification

- [ ] **Step 1: Run full package test suite**

Run: `pnpm --filter @airo/ai-transport test`
Expected: All tests PASS

- [ ] **Step 2: Run full workspace tests (catches downstream breakage)**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 3: Run typecheck across workspace**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Run lint**

Run: `pnpm --filter @airo/ai-transport lint`
Expected: No lint errors

- [ ] **Step 5: Run build**

Run: `pnpm build`
Expected: Build succeeds

---

## Compatibility Summary

| Scenario                                | Behavior                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| New server → old client                 | Client gets fewer, larger `chunk`/`tool_input_delta` messages. Same `message` event, same `{ type, content, data }` format. Works without changes. |
| Old server → new client                 | Client gets individual messages as before. Client-side RAF buffering handles rendering. Works without changes.                                     |
| Recovery (new server)                   | Replay applies same coalescing. `bufferedEventCount` matches coalesced count. ACK timeout scales with coalesced count.                             |
| Mixed deploy (old agent, new transport) | `WebSocketSubscriber` constructor third arg is optional. Old callers get default 30ms window.                                                      |

## Interaction with Client-Side RAF Buffering

Server coalescing (~30ms) and client RAF buffering (~16ms) are complementary layers:

- **Server coalescing** reduces: WebSocket frames, Socket.IO deserialization, handler dispatch overhead, RAF `schedule()` call frequency
- **Client RAF buffering** reduces: React renders, Zustand store mutations
- With server coalescing, the client's RAF buffer has less incoming work — fewer schedule calls, less GC pressure, buffer more likely empty at flush time
- **No client changes required** — the existing `storeUpdateBuffer`, `toolDeltaBuffer`, and `rafScheduler` continue to work correctly with larger, less frequent messages
