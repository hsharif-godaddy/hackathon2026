# Contextual Messaging Pattern

## Overview

The contextual messaging pattern allows widgets to send structured data to backend tools without cluttering the chat UI with large JSON payloads. This is achieved using the `useContextualMessage` hook and WebSocket context attachments.

## Architecture

**Frontend (Browser)**

- Widget → `useContextualMessage` → `useStreamingWebSocket` → Socket.IO

**Backend (Node.js)**

- Socket.IO → `contextProvider` → Tool execution with context

## How It Works

### 1. Frontend: Send Message with Context

```typescript
import { useContextualMessage } from '@/hooks/useContextualMessage'

function MyWidget() {
  const { sendContextualMessage } = useContextualMessage()

  const handleSave = async () => {
    await sendContextualMessage({
      // User sees this in chat (keep it clean!)
      message: 'Save these 3 items',

      // Backend receives this (hidden from UI)
      contextType: 'my_widget_context',
      contextData: {
        items: [...], // Your complex data here
        metadata: { ... }
      },

      // Persistence strategy
      persistence: 'ephemeral', // or 'save' for multi-turn
      source: 'my-widget'
    })
  }
}
```

### 2. Backend: Read from Context

```typescript
// In your tool (agents/src/tools/ai-lib-tools/my-tool.ts)
export const myTool: Tool = createTool(
  "Tool description",
  z.object({
    // Optional parameters when using context
    itemIds: z.string().optional(),
  }),
  async (input, context) => {
    // Step 1: Try to get data from context (includes edits!)
    const contextAttachments = context?.contextAttachments;
    const myAttachment = contextAttachments?.find(
      (att: any) => att.type === "my_widget_context",
    );

    let items = myAttachment?.data?.items;

    // Step 2: Fallback to other methods if needed
    if (!items) {
      // Use input.itemIds or session storage, etc.
    }

    // Step 3: Process the data
    // ...
  },
);
```

## Benefits

✅ **Clean Chat UI** - Users only see natural language messages
✅ **Full Data Transfer** - Backend receives complete structured data
✅ **Preserves Edits** - Frontend state changes are captured
✅ **Backward Compatible** - Fallback to session/IDs if context not available
✅ **Reusable Pattern** - Works for any widget-to-tool communication

## Example: Social Post Save

**Frontend (app/src/app/develop/components/widgets/SocialPostFlowContext.tsx)**

```typescript
const { sendContextualMessage } = useContextualMessage();

const triggerSave = useCallback(
  async (posts: SocialPostData[]) => {
    await sendContextualMessage({
      message: `Save these ${posts.length} social posts`,
      contextType: "social_post_context",
      contextData: {
        posts, // Full edited posts with all changes
        topic: "Summer Sale",
      },
      persistence: "ephemeral",
      source: "social-post-widget",
    });
  },
  [sendContextualMessage],
);
```

**Backend (agents/src/tools/ai-lib-tools/social-post-save.ts)**

```typescript
// Check context first
let posts = retrievePostsFromContext(context);

// Fallback to session if needed
if (!posts) {
  posts = retrievePostsFromSession(sessionId, stateManager, postIds);
}
```

## When to Use

Use this pattern when:

- Widget needs to pass complex/large data structures
- User has edited data in the UI that needs to reach the backend
- You want to keep chat messages user-friendly
- Data doesn't need to be visible in conversation history

## Related Files

- `app/src/hooks/useContextualMessage.ts` - Reusable hook
- `app/src/hooks/useStreamingWebSocket.ts` - WebSocket implementation
- `agents/src/server/ai-lib-websocket-server.ts` - Backend context processing
- `agents/src/services/ContextAttachmentRegistry.ts` - Context registry (optional)
