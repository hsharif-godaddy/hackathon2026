# Stop & Queue: User-Agent Interaction Features

## Overview

Two features that give users control during agent streaming:

1. **Stop Button** — terminate the current agent turn immediately
2. **Queue Message** — type a message during streaming, auto-sent when the agent finishes

## Architecture

### Stop Button

**Server:** `stop_generation` Socket.IO event sets `userStopped: true` on `ConnectionStateData`, then calls `abortController.abort()`. The existing abort-aware stream loop breaks cleanly. `completeConversation()` always runs (persistence, hooks, complete event). The `finishReason` is `'user_stopped'` (vs `'aborted'` for disconnect timeout).

**Client:** `StreamingWebSocketController.stopGeneration()` emits the event. Stop button renders conditionally when `isStreaming && onStopGeneration`. Store detects `finishReason: 'user_stopped'` in `finalizeStream` and sets `userStopped` flag on the completed message. UI shows "You stopped the response" info alert.

## File Map

| File                                                             | Changes                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/ai-transport/src/connection-state-manager.ts`          | `userStopped` field                                    |
| `packages/ai-transport/src/experimental-websocket-server.ts`     | `stop_generation` handler, finishReason logic          |
| `packages/ai-transport/src/connection-recovery-manager.ts`       | `userStopped` in recovery literal                      |
| `app/src/services/websocket/StreamingWebSocketController.ts`     | `stopGeneration()` method                              |
| `app/src/hooks/useStreamingWebSocket.ts`                         | Expose `stopGeneration`                                |
| `app/src/app/develop/[id]/page.tsx`                              | Wire to ChatPane                                       |
| `app/src/app/develop/components/chat/ChatInput.tsx`              | Stop button, streaming-aware input                     |
| `app/src/app/develop/components/chat/ChatPane.tsx`               | Stop wiring                                            |
| `app/src/stores/useStreamingConversationStore.ts`                | `userStopped` on messages, `user_stopped` finishReason |
| `app/src/app/develop/components/StreamingIntegratedResponse.tsx` | User stopped alert                                     |
| `app/src/app/develop/components/StreamingMessage.tsx`            | `userStopped` content check                            |
