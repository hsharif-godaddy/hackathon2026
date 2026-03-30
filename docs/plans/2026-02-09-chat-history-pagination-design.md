---
status: not-implemented
---

# Chat History Pagination Design

**Date:** 2026-02-09
**Status:** Draft
**Author:** Brainstorming session

## Problem

Chat history loading is not paginated. When loading an existing app:

- Backend loads ALL messages from database into memory
- All messages streamed over WebSocket
- Frontend stores entire history in memory
- Results in slow load times for apps with long conversation history

## Solution

Implement cursor-based pagination for chat history with infinite scroll UX.

### Key Decisions

| Decision            | Choice                                                          |
| ------------------- | --------------------------------------------------------------- |
| Pagination strategy | Cursor-based (message ID)                                       |
| Page size           | 50 messages                                                     |
| Initial load        | Most recent 50 messages                                         |
| Load more trigger   | Infinite scroll (scroll near top)                               |
| Transport           | WebSocket only (no HTTP fallback)                               |
| Scroll behavior     | Smart auto-scroll (near bottom = auto, scrolled up = indicator) |
| Scroll preservation | JavaScript scroll anchor restoration                            |

## Architecture

### Flow Overview

```
[Initial Connection]
Server loads 50 most recent messages
Server → history_message (newest)
Server → history_message (...)
Server → history_message (oldest of batch)
Server → history_complete { hasMore: true, nextCursor: "<oldest_msg_id>", total: 342 }

[User scrolls to top]
Client → load_more_history { cursor: "<oldest_msg_id>", limit: 50, conversationId }
Server loads 50 messages older than cursor
Server → history_message (...)
Server → history_complete { hasMore: true, nextCursor: "<new_oldest_id>", total: 342 }

[Eventually]
Server → history_complete { hasMore: false, nextCursor: null }
```

## Implementation Details

### 1. HistoryProvider Interface

**File:** `packages/ai-lib/src/websocket/interfaces.ts`

```typescript
// Current
loadHistory(conversationId: string, appId: string): Promise<PersistedMessage[]>

// New
loadHistory(
  conversationId: string,
  appId: string,
  options?: { before?: string; limit?: number }
): Promise<{
  messages: PersistedMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  total?: number;
}>
```

### 2. Database Query

**File:** `agents/src/database/repositories/ConversationRepository.ts`

Add new method `getMessagesPaginated()`:

```sql
-- Get total count
SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = ?

-- Get paginated messages (newest first, then reverse for display)
SELECT * FROM conversation_messages
WHERE conversation_id = ?
  AND (? IS NULL OR created_at < (SELECT created_at FROM conversation_messages WHERE id = ?))
ORDER BY created_at DESC
LIMIT ?
```

### 3. ConnectionRecoveryManager Updates

**File:** `packages/ai-lib/src/websocket/connection-recovery-manager.ts`

- Update `executeRecoveryFlow()` to pass `{ limit: 50 }` to historyProvider
- Update `sendStreamCompletedStatus()` similarly
- Include pagination metadata in `history_complete` event:

```typescript
socket.emit("message", {
  type: "history_complete",
  content: "",
  data: {
    messageCount: result.messages.length,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
    total: result.total,
  },
} as WebSocketMessage);
```

### 4. New WebSocket Event: load_more_history

**File:** `packages/ai-lib/src/websocket/experimental-websocket-server.ts`

Add handler for `load_more_history` event:

```typescript
socket.on(
  "load_more_history",
  async (data: { cursor: string; limit?: number; conversationId: string }) => {
    // Validate ownership
    // Load paginated history via historyProvider
    // Stream history_message events
    // Send history_complete with pagination metadata
  },
);
```

### 5. Frontend Store Updates

**File:** `app/src/stores/useStreamingConversationStore.ts`

Add pagination state:

```typescript
interface StreamingConversationState {
  // Existing fields...

  // New pagination state
  historyHasMore: boolean;
  historyNextCursor: string | null;
  historyLoadingMore: boolean;
}
```

Add actions:

- `setHistoryPagination({ hasMore, nextCursor })`
- `setHistoryLoadingMore(loading: boolean)`
- `prependMessages(messages: ChatMessage[])` - for prepending older messages

### 6. HistoryCompleteHandler Updates

**File:** `app/src/hooks/websocket/handlers/HistoryCompleteHandler.ts`

Extract pagination metadata:

```typescript
store.setHistoryPagination({
  hasMore: data.data?.hasMore ?? false,
  nextCursor: data.data?.nextCursor ?? null,
});
store.setHistoryLoadingMore(false);
```

### 7. HistoryMessageHandler Updates

**File:** `app/src/hooks/websocket/handlers/HistoryMessageHandler.ts`

Support prepend mode for "load more" batches:

```typescript
// Detect if this is initial load or load-more based on store state
const mode = store.historyLoadingMore
  ? "prepend"
  : isFirstBatch
    ? "replace"
    : "append";
```

### 8. Scroll Detection & Anchor Restoration

**File:** `app/src/app/develop/components/chat/ChatPane.tsx` or `StreamingMessageList.tsx`

```typescript
const scrollContainerRef = useRef<HTMLDivElement>(null);
const prevScrollHeightRef = useRef<number>(0);

// Scroll detection
const handleScroll = (e: React.UIEvent) => {
  const { scrollTop } = e.currentTarget;
  const nearTop = scrollTop < 100;

  if (nearTop && historyHasMore && !historyLoadingMore) {
    // Capture scroll height before loading
    prevScrollHeightRef.current = e.currentTarget.scrollHeight;

    socket.emit("load_more_history", {
      cursor: historyNextCursor,
      limit: 50,
      conversationId,
    });
    store.setHistoryLoadingMore(true);
  }
};

// Scroll anchor restoration (after messages prepend)
useEffect(() => {
  if (!historyLoadingMore && prevScrollHeightRef.current > 0) {
    const container = scrollContainerRef.current;
    if (container) {
      const newScrollHeight = container.scrollHeight;
      const addedHeight = newScrollHeight - prevScrollHeightRef.current;
      container.scrollTop += addedHeight;
    }
    prevScrollHeightRef.current = 0;
  }
}, [historyLoadingMore, messages.length]);

// Smart auto-scroll for new messages
const handleNewMessage = () => {
  const container = scrollContainerRef.current;
  if (!container) return;

  const { scrollTop, scrollHeight, clientHeight } = container;
  const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

  if (isNearBottom) {
    container.scrollTop = container.scrollHeight;
  } else {
    showNewMessageIndicator();
  }
};
```

## Edge Cases

### Loading indicator

- Show spinner at top of message list while `historyLoadingMore === true`
- Prevent duplicate requests via the loading flag

### Error handling

```typescript
// In history_complete handler
if (data.data?.error) {
  store.setHistoryLoadingMore(false);
  // Show error toast, enable retry
  return;
}
```

### Empty conversation

- `history_complete { hasMore: false, messages: [] }`
- No scroll handler activation needed

### Conversation switch

- Reset pagination state when `conversationId` changes
- Clear `historyNextCursor`, set `historyHasMore: true`, `historyLoadingMore: false`

### Recovery with reconnection

- Initial load uses `mode: 'replace'`
- Load more uses `mode: 'prepend'`

## Files to Modify

| Layer      | File                                                             | Changes                                          |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| **ai-lib** | `packages/ai-lib/src/websocket/interfaces.ts`                    | Update `HistoryProvider` interface               |
| **ai-lib** | `packages/ai-lib/src/websocket/connection-recovery-manager.ts`   | Pass limit, add pagination to `history_complete` |
| **ai-lib** | `packages/ai-lib/src/websocket/experimental-websocket-server.ts` | Add `load_more_history` event handler            |
| **agents** | `agents/src/database/repositories/ConversationRepository.ts`     | Add `getMessagesPaginated()` method              |
| **agents** | `agents/src/server/ai-lib-websocket-server.ts`                   | Update `historyProvider` implementation          |
| **app**    | `app/src/hooks/websocket/handlers/HistoryCompleteHandler.ts`     | Extract pagination metadata                      |
| **app**    | `app/src/hooks/websocket/handlers/HistoryMessageHandler.ts`      | Support prepend mode                             |
| **app**    | `app/src/stores/useStreamingConversationStore.ts`                | Add pagination state + actions                   |
| **app**    | `app/src/app/develop/components/chat/ChatPane.tsx`               | Scroll detection + anchor restoration            |

## Implementation Order

1. **Database layer** - Add `getMessagesPaginated()` to ConversationRepository
2. **Interface** - Update `HistoryProvider` interface in ai-lib
3. **Server implementation** - Update historyProvider in agents service
4. **Initial load** - Update ConnectionRecoveryManager to use pagination
5. **Load more event** - Add `load_more_history` WebSocket handler
6. **Frontend store** - Add pagination state and actions
7. **Frontend handlers** - Update HistoryCompleteHandler and HistoryMessageHandler
8. **Scroll UX** - Implement scroll detection and anchor restoration

## Configuration

| Setting                  | Value | Notes                              |
| ------------------------ | ----- | ---------------------------------- |
| Initial load size        | 50    | Messages loaded on connection      |
| Load more size           | 50    | Messages loaded per scroll trigger |
| Max limit                | 100   | Server-enforced maximum            |
| Scroll trigger threshold | 100px | Distance from top to trigger load  |
| Near bottom threshold    | 100px | Distance for smart auto-scroll     |

## Out of Scope

- LLM context pagination (ConversationHistoryLoader) - remains unchanged, loads all for token-based truncation
- HTTP fallback endpoints - WebSocket only
- Message search/jump-to-date features
