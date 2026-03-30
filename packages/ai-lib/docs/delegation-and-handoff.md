# Agent Delegation and Handoff Guide

This guide explains the difference between **delegation** (calling another agent) and **handoff** (switching the active agent), and how to use each feature.

## Overview

### Delegation (formerly "handoff tool")

**Delegation** is when one agent calls another agent to perform a task and waits for the result. The calling agent remains in control.

- **Use case**: "I need a specialized agent to create a schema for me"
- **Tool**: `delegate` tool (via `createDelegateTool` or `addDelegationTools`)
- **Behavior**: Calls another agent, gets response, returns control to caller
- **Analogy**: Like calling a function or making an API request

### Handoff (agent switching)

**Handoff** is when you switch from one agent to another as the active agent. The original agent is no longer in control.

- **Use case**: "The user wants to switch from the developer agent to a specialized agent"
- **Implementation**: Handoff tool and state manager (via `createHandoffTool` and `createSessionStateManager`)
- **Behavior**: Switches the active agent in your application
- **Analogy**: Like changing the current user or switching tabs

## Delegation Tool

### Basic Usage

```typescript
import { createAgentFactory, addDelegationTools } from "@airo/ai-lib";

const factory = createAgentFactory();

const agents = factory.defineAgents({
  coordinator: {
    name: "Coordinator",
    system: "You coordinate tasks and can delegate to specialists",
    model: await getModel("gpt4o"),
    tools: {
      ...addDelegationTools(factory, "coordinator", true), // Includes history tool
    },
    handoffs: [{ agentName: "specialist", description: "Specialized tasks" }],
  },
  specialist: {
    name: "Specialist",
    system: "You handle specialized tasks",
    model: await getModel("gpt4o"),
    tools: {},
    handoffs: [],
  },
});

// The coordinator can now use the 'delegate' tool to call the specialist
const result = await agents.get("coordinator").execute({
  prompt: "Please delegate the task of analyzing data to the specialist",
});
```

### Delegation Tool Parameters

The `delegate` tool accepts:

- `targetAgent` (string, required): ID of the agent to delegate to
- `task` (string, required): Clear description of the task
- `context` (object, optional): Additional context data
- `parameters` (object, optional): Parameters for the target agent
- `reason` (string, optional): Reason for the delegation

### Delegation History

When you include the history tool (`addDelegationTools(factory, agentId, true)`), agents can query past delegations:

```typescript
// In agent's system prompt or during execution
"Use the delegationHistory tool to see past delegations";

// The tool accepts:
// - agentFilter: Filter by specific agent
// - limit: Number of entries to return (default: 10)
// - status: Filter by 'pending', 'completed', or 'failed'
```

## Handoff Tool (Agent Switching)

### Basic Usage

The handoff tool allows agents to switch the active agent handling a conversation. It integrates with a state manager to track which agent is active per session.

```typescript
import {
  createAgentFactory,
  createHandoffTool,
  createSessionStateManager,
  getModel,
} from "@airo/ai-lib";

const factory = createAgentFactory();

// Create state manager for tracking active agent per session
const stateManager = createSessionStateManager({
  defaultAgentId: "developer",
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
});

// Define agents with handoff configurations
const agents = factory.defineAgents({
  developer: {
    name: "Developer",
    system:
      "You handle development. Use the handoff tool to switch to specialists.",
    model: await getModel("gpt4o"),
    tools: {
      handoff: createHandoffTool({
        sourceAgentId: "developer",
        validTargets: ["specialist"],
        stateManager,
        sessionId: "user-session-123",
      }),
    },
    handoffs: [
      { agentName: "specialist", description: "Specialized operations" },
    ],
  },
  specialist: {
    name: "Specialist Agent",
    system: "You handle specialized operations",
    model: await getModel("gpt4o"),
    tools: {},
    handoffs: [],
  },
});
```

### Handoff Tool Configuration

```typescript
interface HandoffToolConfig {
  sourceAgentId: string; // Current agent ID
  validTargets: string[]; // Allowed target agent IDs
  stateManager?: HandoffStateManager; // State manager for WebSocket integration
  sessionId?: string | ((context?: Record<string, unknown>) => string | undefined); // Session ID
  validateHandoff?: boolean; // Validate targets (default: true)
}
```

### Adding Handoff Tools to Multiple Agents

```typescript
import { addHandoffToolToAgents } from "@airo/ai-lib";

const sessionId = "user-session-123";

const handoffTools = addHandoffToolToAgents(
  agents,
  ["developer", "coordinator"],
  stateManager,
  (agentId) => sessionId,
);
```

### Validation

By default, the handoff tool validates that the target is in `validTargets`. You can disable this:

```typescript
const handoffTool = createHandoffTool({
  sourceAgentId: "developer",
  validTargets: ["specialist"],
  validateHandoff: false, // Allow any handoff
});
```

## When to Use Each

### Use Delegation When:

- An agent needs help from another agent
- You want the result back to continue processing
- The calling agent remains responsible for the task
- You're building autonomous agent workflows
- Example: "Developer agent asks specialized agent to create a schema"

### Use Handoff When:

- User explicitly switches between agents
- You're building a multi-agent chat interface
- Different agents handle different conversation phases
- You need to change the active agent in your UI
- Example: "User clicks 'Switch to Specialist Agent' button"

## Migration from Old "Handoff" Tool

If you were using the old `handoff` tool (now renamed to `delegate`):

### Update Imports

```typescript
// Old
import { createHandoffTool, addHandoffTools } from "@airo/ai-lib";

// New
import { createDelegateTool, addDelegationTools } from "@airo/ai-lib";
```

### Update Tool Names

```typescript
// Old
const tools = {
  ...addHandoffTools(factory, "agentId"),
};

// New
const tools = {
  ...addDelegationTools(factory, "agentId"),
};
```

### Update System Prompts

```typescript
// Old
system: "Use the handoff tool to delegate tasks";

// New
system: "Use the delegate tool to delegate tasks";
```

### Backward Compatibility

The old `addHandoffTools` function is still available but deprecated:

```typescript
// Still works, but deprecated
import { addHandoffTools } from "@airo/ai-lib";

const tools = {
  ...addHandoffTools(factory, "agentId"), // Internally calls addDelegationTools
};
```

## Complete Example

Here's a complete example showing both delegation and handoff:

```typescript
import {
  createAgentFactory,
  getModel,
  addDelegationTools,
  createHandoffTool,
  createSessionStateManager,
} from "@airo/ai-lib";

async function main() {
  const factory = createAgentFactory();
  const stateManager = createSessionStateManager({
    defaultAgentId: "coordinator",
    onAgentSwitch: (sessionId, from, to, prompt) => {
      console.log(`[HANDOFF] ${from} -> ${to} (session: ${sessionId})`);
    },
  });

  const sessionId = "user-session-123";

  // Define agents
  const agents = factory.defineAgents({
    coordinator: {
      name: "Coordinator",
      system: `You coordinate tasks. Use the delegate tool to ask specialists for help.
               Use the handoff tool to switch control to another agent.`,
      model: await getModel("gpt4o"),
      tools: {
        ...addDelegationTools(factory, "coordinator", true),
        handoff: createHandoffTool({
          sourceAgentId: "coordinator",
          validTargets: ["developer", "specialist"],
          stateManager,
          sessionId,
        }),
      },
      handoffs: [
        { agentName: "developer", description: "Development tasks" },
        { agentName: "specialist", description: "Specialized operations" },
      ],
    },
    developer: {
      name: "Developer",
      system: "You handle development tasks",
      model: await getModel("gpt4o"),
      tools: {
        ...addDelegationTools(factory, "developer", true),
      },
      handoffs: [
        { agentName: "specialist", description: "Specialized operations" },
      ],
    },
    specialist: {
      name: "Specialist Agent",
      system: "You handle specialized operations",
      model: await getModel("gpt4o"),
      tools: {},
      handoffs: [],
    },
  });

  // Example 1: Coordinator delegates to developer (delegation — calling agent stays in control)
  console.log("=== Delegation Example ===");
  const coordinator = agents.get("coordinator");
  const delegationResult = await coordinator.generate(
    "Please delegate the task of creating a REST API to the developer agent",
  );
  console.log("Delegation result:", delegationResult);

  // Example 2: Coordinator hands off to developer (handoff — switches active agent)
  console.log("\n=== Handoff Example ===");
  // When the coordinator uses the handoff tool, stateManager tracks the switch
  await coordinator.generate("Hand off to the developer agent for direct work");

  // Check who is active now
  const currentAgentId = stateManager.getCurrentAgent(sessionId);
  console.log(`Active agent is now: ${currentAgentId}`); // 'developer'

  // Process with the now-active agent
  const developer = agents.get("developer");
  const devResult = await developer.generate("Create a users API endpoint");
  console.log("Developer result:", devResult);
}

main();
```

## Best Practices

1. **Use delegation for agent-to-agent communication**: When agents need to work together autonomously
2. **Use handoff for user-initiated switches**: When users explicitly want to change agents
3. **Always provide clear context**: Include `reason` in delegations and `prompt` in handoffs for debugging
4. **Use state manager callbacks**: Use `onAgentSwitch` to track handoffs and update UI
5. **Configure handoff permissions**: Use `validTargets` to explicitly define allowed transitions
6. **Use delegation history**: Enable history tools to help agents learn from past interactions

## See Also

- [Handoff State Manager](./handoff-state-manager.md)
- [Examples](../examples/)
