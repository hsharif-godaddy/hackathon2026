# Manual Recovery Analysis - Safety Assessment

**Feature:** Manual recovery flow in `app/src/hooks/useStreamingWebSocket.ts`

**Current Status:** Always enabled

---

## 1. ✅ Works Correctly with Automatic Recovery

### Client-Side (Lines 390-414)

```typescript
socket.on("connect", () => {
  if (socket.recovered) {
    // Auto-recovery path (Socket.IO preserved socket ID)
    wasRecoveredRef.current = true;
    setWebSocketState({ connected: true, status: "idle" });
  } else if (previousSocketId && previousSocketId !== socket.id) {
    // Manual recovery path (page reload, new socket ID)
    wasRecoveredRef.current = true;
    setWebSocketState({ connected: true, status: "idle" });
    sessionStorage.setItem(`socket_id_${appId}`, socket.id);
  } else {
    // Fresh connection (no recovery)
    wasRecoveredRef.current = false;
    // ...
  }
});
```

**Analysis:**

- ✅ Uses `if/else if/else` chain - **mutually exclusive**
- ✅ Auto-recovery checked FIRST (takes precedence)
- ✅ Manual recovery only triggers if auto-recovery didn't happen
- ✅ Both paths set `wasRecoveredRef.current = true` consistently

### Server-Side (Lines 395-447, 448+)

```typescript
if (socket.recovered && this.disconnectedStreams.has(socketId)) {
  // Auto-recovery path
  // Replay events, re-subscribe, cleanup
} else if (previousSocketId && this.disconnectedStreams.has(previousSocketId)) {
  // Manual recovery path
  // Replay events, migrate socket ID, re-subscribe, cleanup
}
```

**Analysis:**

- ✅ Uses `if/else if` chain - **mutually exclusive**
- ✅ Auto-recovery checked FIRST (takes precedence)
- ✅ Manual recovery only triggers if auto-recovery didn't happen
- ✅ Both paths use reliable `socket.emit()` plus ack gating (prevents loss and duplicates)

**Verdict:** ✅ **No conflicts between auto and manual recovery**

---

## 2. ⚠️ Duplicate Message Risk

### Server-Side: No Duplicates

- ✅ Both paths use `socket.emit()` (lines 413, 487) so buffered events are guaranteed to arrive
- ✅ Recovery stays in handshake mode until `recovery_ack` / `catchup_ack`
- ✅ This prevents the multi-cycle duplicate bug without relying on volatile emits

### Client-Side: Potential Issue

**Problem:** sessionStorage is NEVER cleaned up

Current behavior:

```typescript
// ON CONNECT (line 405, 412): Store socket ID
sessionStorage.setItem(`socket_id_${appId}`, socket.id);

// ON COMPLETE (line 872-897): ❌ No cleanup
// ON ERROR (line 898+): ❌ No cleanup
// ON DISCONNECT (line 514+): ❌ No cleanup
```

**What this causes:**

1. Stream completes successfully
2. Socket ID remains in sessionStorage
3. User reloads page
4. Client sends `previousSocketId` in auth (line 378)
5. Server checks `disconnectedStreams.has(previousSocketId)` (line 449)
6. **Server doesn't find it** (stream already completed and cleaned up)
7. Recovery fails gracefully, fresh connection starts

**Impact:**

- ❌ **Wasteful**: Sends unnecessary `previousSocketId` on every page reload
- ✅ **Safe**: Server gracefully handles missing socket ID (no crash)
- ✅ **No duplicates**: Failed recovery attempts don't cause duplicate messages

**Recommended Fix:**

```typescript
case 'complete':
  // ... existing code ...

  // Clean up sessionStorage after successful completion
  if (currentAppId) {
    sessionStorage.removeItem(`socket_id_${currentAppId}`)
  }
  break

case 'error':
  // ... existing code ...

  // Clean up sessionStorage on error
  if (currentAppId) {
    sessionStorage.removeItem(`socket_id_${currentAppId}`)
  }
  break
```

**Verdict:** ⚠️ **Minor inefficiency, but safe (no duplicates)**

---

## 3. ✅ Safe to Enable by Default (with cleanup fix)

### Multi-Tab Scenario

**Question:** What if user has multiple tabs open?

**Answer:** ✅ **Safe** - `sessionStorage` is per-tab (unlike `localStorage`)

- Tab A has its own socket ID in sessionStorage
- Tab B has its own socket ID in sessionStorage
- No interference between tabs

### Edge Cases Tested

#### Case 1: Auto-Recovery Success

```
1. Stream starts (socket-A)
2. Brief network disconnect
3. Socket.IO auto-recovers (socket-A preserved)
4. ✅ Auto-recovery path triggered
5. ✅ Manual recovery skipped (else if)
6. ✅ No duplicates (ack gating)
```

#### Case 2: Manual Recovery Success

```
1. Stream starts (socket-A)
2. User reloads page (Socket.IO can't recover)
3. New socket (socket-B) connects
4. Client sends previousSocketId=socket-A
5. ✅ Manual recovery path triggered
6. ✅ Auto-recovery skipped (socket.recovered=false)
7. ✅ No duplicates (ack gating)
```

#### Case 3: Recovery Not Needed

```
1. Stream completes successfully
2. User reloads page
3. Client sends previousSocketId (stale)
4. Server checks disconnectedStreams (not found)
5. ✅ Recovery skipped gracefully
6. ✅ Fresh connection starts
7. ⚠️ Wasteful: Could avoid sending stale socket ID
```

#### Case 4: Multiple Disconnect Cycles

```
1. Stream starts (socket-A)
2. Disconnect → Reconnect (Cycle 1)
3. Server replays with reliable `socket.emit`
4. Disconnect → Reconnect (Cycle 2)
5. ✅ No duplicates from Cycle 1 (ack gating prevented stale replays)
6. ✅ Only new events replayed
```

### Production Readiness Checklist

- ✅ **Mutually exclusive paths** (no conflicts)
- ✅ **Volatile emits prevent duplicates** (our fix)
- ✅ **Graceful failure handling** (stale socket IDs ignored)
- ✅ **Multi-tab safe** (sessionStorage per-tab)
- ✅ **No memory leaks** (server cleans up disconnectedStreams after timeout)
- ⚠️ **Minor inefficiency** (sessionStorage not cleaned up)

---

## Recommendations

Manual recovery is always enabled. The remaining work is operational hardening:

- Add `sessionStorage` cleanup when streams complete or error so stale IDs are not reused.
- Keep the acknowledgement handshake to guarantee no data loss during recovery.

---

## Final Verdict

### Question 1: Works correctly with automatic recovery?

**Answer:** ✅ **YES** - Mutually exclusive paths, auto-recovery takes precedence

### Question 2: Won't send duplicate messages?

**Answer:** ✅ **YES** - Reliable emits + ack handshakes prevent duplicates

### Question 3: Safe to enable by default?

**Answer:** ✅ **YES**, provided sessionStorage entries are cleaned AFTER each stream

---

## 2025 Updates

- Manual recovery is always enabled; sessionStorage socket ids are automatically cleared on stream completion, errors, disconnects, and app switches.
- Recovery now uses a two-phase acknowledgement:
  - `recovery_status` / `replay_complete` → client sends `recovery_ack`
  - Any new events published while waiting for the ack are sent via `catchup_status` / `catchup_complete` and require a `catchup_ack`
  - This guarantees the server never advances `lastDeliveredSequence` without confirmation.
- If the event buffer overflows, the server sets `lossDetected`/`lostEventCount` in the recovery payload, and the client surfaces a “Some data may be missing” warning so users know to re-request context.

## Suggested Implementation

```typescript
// In app/src/hooks/useStreamingWebSocket.ts

case 'complete':
  flushToolDeltaBufferImmediate()
  // ... existing code ...

  // Clean up sessionStorage after successful completion
  if (currentAppId) {
    sessionStorage.removeItem(`socket_id_${currentAppId}`)
  }

  handleCommitComplete(data.data?.commitHash)
  break

case 'error':
  flushToolDeltaBufferImmediate()
  // ... existing error handling ...

  // Clean up sessionStorage on error (after determining it's not recoverable)
  if (currentAppId && !isAppNotFound) {
    sessionStorage.removeItem(`socket_id_${currentAppId}`)
  }
  break
```

**Estimated effort:** 10 minutes + testing
**Risk:** Low
**Impact:** High (better UX for page reloads during streaming)
