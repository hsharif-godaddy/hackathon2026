# Client-Side Tools Architecture

## Overview

Client-side tools enable AI agents to trigger browser-side actions that require user authentication or browser context. This allows agents to perform operations like publishing, navigation, or UI updates through WebSocket communication.

**Key Benefits:**

- ✅ User authentication (JWT) handled automatically by browser
- ✅ Access to browser APIs and context
- ✅ Type-safe communication between agents and client
- ✅ Request/response pattern with timeouts
- ✅ Proper error handling and logging

---

## Architecture

### Components

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Agent Tool    │────────>│ ClientAction     │────────>│   WebSocket     │
│  (AI-Lib Tool)  │         │    Service       │         │                 │
└─────────────────┘         └──────────────────┘         └────────┬────────┘
                                                                   │
                                                                   │ client_action
                                                                   │
                                                                   v
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Client Result  │<────────│ ClientAction     │<────────│   Browser       │
│                 │         │    Handler       │         │   (Frontend)    │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                                                   │
                                                                   v
                                                          ┌─────────────────┐
                                                          │ Action Executor │
                                                          │  (publishAction)│
                                                          └─────────────────┘
```

### Request Flow

1. **Agent calls tool** → AI agent invokes client-side tool (e.g., `publishClient`)
2. **Tool gets service** → Retrieves `ClientActionService` from global registry using socketId
3. **Service sends request** → Emits `client_action` message via WebSocket
4. **Client receives** → Browser's `ClientActionHandler` receives message
5. **Executor runs** → Dispatches to registered executor (e.g., `publishAction`)
6. **Result returned** → Executor sends `client_action_result` back
7. **Service resolves** → Promise resolves with result
8. **Tool returns** → AI agent receives result

---

## File Structure

```
agents/
├── src/
│   ├── server/
│   │   └── ai-lib-websocket-server.ts     # Service registry & lifecycle
│   ├── services/
│   │   └── ClientActionService.ts          # Request/response manager
│   ├── tools/
│   │   ├── publish-client-tool.ts          # Core publish logic
│   │   └── ai-lib-tools/
│   │       ├── publish-client.ts           # AI tool wrapper
│   │       └── index.ts                    # Tool exports
│   └── prompts/
│       └── develop/
│           └── deployment.md               # Agent instructions

app/
├── src/
│   ├── hooks/
│   │   └── websocket/
│   │       ├── handlers/
│   │       │   ├── ClientActionHandler.ts  # Message handler
│   │       │   └── index.ts                # Handler registry
│   │       └── actions/
│   │           ├── types.ts                # Type definitions
│   │           ├── index.ts                # Executor registry
│   │           └── publishAction.ts        # Publish executor
│   ├── services/
│   │   └── websocket/
│   │       └── TransportSupervisor.ts      # Handler registration
│   └── components/
│       └── providers/
│           └── QueryClientProvider.tsx     # Global query client
```

---

## How to Add a New Client-Side Tool

### Step 1: Create the Action Executor (Frontend)

**Location:** `app/src/hooks/websocket/actions/yourAction.ts`

```typescript
import { logger } from "@/lib/request-context";
import type { ClientActionExecutor } from "./types";

export const yourAction: ClientActionExecutor = async (params, context) => {
  // 1. Validate parameters
  const { requiredParam } = params;
  if (!requiredParam || typeof requiredParam !== "string") {
    throw new Error("requiredParam is required and must be a string");
  }

  // 2. Extract appId from context (always available)
  const appId = context.currentAppId;
  if (!appId) {
    throw new Error("appId not available in context");
  }

  try {
    logger.info("websocket.client-action.your-action.begin", {
      appId,
      requiredParam,
    });

    // 3. Perform the action
    // - Can access stores: useDevelopPageStore.getState()
    // - Can call APIs: appFetch()
    // - Can update UI state
    // - Can access React Query: getQueryClient()

    const result = await doSomething(requiredParam);

    logger.info("websocket.client-action.your-action.success", {
      appId,
    });

    // 4. Return result
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("websocket.client-action.your-action.error", {
      appId,
      error: errorMessage,
    });
    throw error;
  }
};
```

### Step 2: Register the Executor

**File:** `app/src/hooks/websocket/actions/index.ts`

```typescript
export * from "./yourAction";

import { publishAction } from "./publishAction";
import { yourAction } from "./yourAction"; // Add import
import type { ClientActionExecutor } from "./types";

export const clientActionExecutors: Record<string, ClientActionExecutor> = {
  publish: publishAction,
  yourAction: yourAction, // Add to registry
};
```

### Step 3: Create the Tool Logic (Backend)

**Location:** `agents/src/tools/your-action-tool.ts`

```typescript
import { logger } from "../logging/index.js";
import type { ClientActionService } from "../services/ClientActionService.js";

export interface YourActionOptions {
  appId: string;
  requiredParam: string;
}

export interface YourActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function executeYourAction(
  options: YourActionOptions,
  clientActionService: ClientActionService,
): Promise<YourActionResult> {
  const { appId, requiredParam } = options;

  logger.info("your-action-tool.begin", {
    appId,
    requiredParam,
  });

  try {
    const clientResult = await clientActionService.executeAction({
      action: "yourAction", // Must match executor registry key
      params: {
        requiredParam,
      },
      timeoutMs: 30000, // Adjust as needed
    });

    if (!clientResult.success) {
      logger.error("your-action-tool.failed", {
        appId,
        error: clientResult.error,
      });
      return {
        success: false,
        error: clientResult.error || "Action failed",
      };
    }

    logger.info("your-action-tool.success", {
      appId,
    });

    return {
      success: true,
      data: clientResult.result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("your-action-tool.error", {
      appId,
      error: errorMessage,
    });
    return {
      success: false,
      error: errorMessage,
    };
  }
}
```

### Step 4: Create the AI Tool Wrapper

**Location:** `agents/src/tools/ai-lib-tools/your-action.ts`

```typescript
import { createTool, type Tool } from "@airo/ai-lib";
import { z } from "zod";
import { executeYourAction } from "../your-action-tool.js";
import { getClientActionService } from "../../server/ai-lib-websocket-server.js";

export const yourActionAITool: Tool = createTool(
  `Description of what this tool does.

WHEN TO USE:
- Specific use case 1
- Specific use case 2

IMPORTANT:
- This requires user authentication
- This action is executed by the client`,
  z.object({
    requiredParam: z.string().describe("Description of this parameter"),
  }),
  async (input, context) => {
    // Extract required context
    const appId = context?.metadata?.appId as string;
    if (!appId) {
      throw new Error("App ID is required");
    }

    // Get socketId from context (set by ai-lib during tool execution)
    const socketId = (context as any)?.socketId as string;
    if (!socketId) {
      throw new Error("Socket ID not available");
    }

    // Get client action service from global registry
    const clientActionService = getClientActionService(socketId);
    if (!clientActionService) {
      throw new Error("Client action service not available");
    }

    // Execute action via client
    const result = await executeYourAction(
      { appId, requiredParam: input.requiredParam },
      clientActionService,
    );

    if (!result.success) {
      throw new Error(result.error || "Action failed");
    }

    return `Success! ${JSON.stringify(result.data)}`;
  },
);
```

### Step 5: Export the Tool

**File:** `agents/src/tools/ai-lib-tools/index.ts`

```typescript
export { yourActionAITool } from "./your-action.js";

// In allAILibTools registry:
export const allAILibTools: Record<string, Tool> = {
  // ... existing tools
  yourAction: yourActionAITool,
};
```

### Step 6: Add to Agent Configuration

**File:** `agents/src/agents/your-agent.ts`

```typescript
tools: {
  // ... existing tools
  yourAction: allAILibTools.yourAction,
}
```

### Step 7: Add Agent Instructions (Optional)

**File:** `agents/src/prompts/your-agent/your-feature.md`

````markdown
## Your Feature

You can perform this action using the `yourAction` tool.

### When to Use

- User explicitly requests this action
- Condition X is met

### Example

```json
{
  "name": "yourAction",
  "arguments": {
    "requiredParam": "value"
  }
}
```
````

````

---

## Best Practices

### 1. Parameter Validation

Always validate parameters in the executor:

```typescript
const { requiredParam } = params
if (!requiredParam || typeof requiredParam !== 'string') {
  throw new Error('requiredParam is required and must be a string')
}
````

### 2. Error Handling

Use try-catch and structured logging:

```typescript
try {
  const result = await doSomething();
  logger.info("action.success", { appId });
  return result;
} catch (error) {
  logger.error("action.error", { appId, error: error.message });
  throw error;
}
```

### 3. Timeouts

Set appropriate timeouts based on operation duration:

```typescript
await clientActionService.executeAction({
  action: 'yourAction',
  params: { ... },
  timeoutMs: 30000,  // Fast operations: 30s
  // timeoutMs: 120000,  // Slow operations like publish: 2 minutes
})
```

### 4. State Management

Access stores via `getState()` to avoid React hook restrictions:

```typescript
const store = useDevelopPageStore.getState();
store.setSomeState(appId, value);
```

### 5. Query Invalidation

Use global query client for React Query operations:

```typescript
import { getQueryClient } from "@/components/providers/QueryClientProvider";

const queryClient = getQueryClient();
if (queryClient) {
  await queryClient.invalidateQueries({ queryKey: ["some-key", appId] });
}
```

---

## Troubleshooting

### Action Not Executing

1. **Check executor registration** - Is it in `clientActionExecutors`?
2. **Check handler registration** - Is `ClientActionHandler` registered in `TransportSupervisor`?
3. **Check tool export** - Is tool exported from `ai-lib-tools/index.ts`?
4. **Check agent config** - Is tool added to agent's tools object?

### Timeout Errors

- Increase `timeoutMs` for slow operations
- Check if action is actually executing in browser
- Check browser console for errors

### Context Not Available

- Use `context.currentAppId` not `context.metadata?.appId`
- Use `(context as any)?.socketId` to get socketId
- Check that context is being passed through correctly

---

## Security Considerations

### Authentication

- Client actions inherit browser's authentication (JWT)
- No need to pass auth tokens explicitly
- Actions are executed with user's permissions

### Validation

- Always validate params in executor
- Don't trust agent-provided data
- Sanitize inputs before using in APIs

### Timeout Protection

- All actions have automatic timeout (default 30s)
- Prevents hanging requests
- Cleans up resources properly

---

## Production Readiness Checklist

- [ ] Executor validates all parameters
- [ ] Structured logging with proper event names
- [ ] Error handling with try-catch
- [ ] Appropriate timeout configured
- [ ] Tool documentation in prompt file
- [ ] Types exported properly
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] Agent can discover and use tool
- [ ] Works in both local and production environments
