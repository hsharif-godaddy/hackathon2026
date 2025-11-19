# Agent Delegation and Handoff Guide

This guide explains the difference between **delegation** (calling another agent) and **handoff** (switching the active agent), and how to use each feature.

## Overview

### Delegation (formerly "handoff tool")
**Delegation** is when one agent calls another agent to perform a task and waits for the result. The calling agent remains in control.

- **Use case**: "I need the database agent to create a schema for me"
- **Tool**: `delegate` tool (via `createDelegateTool` or `addDelegationTools`)
- **Behavior**: Calls another agent, gets response, returns control to caller
- **Analogy**: Like calling a function or making an API request

### Handoff (agent switching)
**Handoff** is when you switch from one agent to another as the active agent. The original agent is no longer in control.

- **Use case**: "The user wants to switch from the developer agent to the database agent"
- **Implementation**: Handoff helpers (via `createHandoffHelpers`)
- **Behavior**: Switches the active agent in your application
- **Analogy**: Like changing the current user or switching tabs

## Delegation Tool

### Basic Usage

```typescript
import { createAgentFactory, addDelegationTools } from '@airo/ai-lib'

const factory = createAgentFactory()

const agents = factory.defineAgents({
  coordinator: {
    name: 'Coordinator',
    system: 'You coordinate tasks and can delegate to specialists',
    model: await getModel('gpt4o'),
    tools: {
      ...addDelegationTools(factory, 'coordinator', true) // Includes history tool
    },
    handoffs: [
      { agentName: 'specialist', description: 'Specialized tasks' }
    ]
  },
  specialist: {
    name: 'Specialist',
    system: 'You handle specialized tasks',
    model: await getModel('gpt4o'),
    tools: {},
    handoffs: []
  }
})

// The coordinator can now use the 'delegate' tool to call the specialist
const result = await agents.get('coordinator').execute({
  prompt: 'Please delegate the task of analyzing data to the specialist'
})
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
"Use the delegationHistory tool to see past delegations"

// The tool accepts:
// - agentFilter: Filter by specific agent
// - limit: Number of entries to return (default: 10)
// - status: Filter by 'pending', 'completed', or 'failed'
```

## Handoff Helpers

### Basic Usage

```typescript
import { createAgentFactory, createHandoffHelpers } from '@airo/ai-lib'

const factory = createAgentFactory()

// Define agents with handoff configurations
const agents = factory.defineAgents({
  developer: {
    name: 'Developer',
    system: 'You handle development',
    model: await getModel('gpt4o'),
    tools: {},
    handoffs: [
      { agentName: 'database', description: 'Database operations' }
    ]
  },
  database: {
    name: 'Database Agent',
    system: 'You handle database operations',
    model: await getModel('gpt4o'),
    tools: {},
    handoffs: []
  }
})

// Create handoff helpers
const handoff = createHandoffHelpers(agents)

// Check if handoff is allowed
if (handoff.canHandoffTo('developer', 'database')) {
  // Switch to database agent
  const databaseAgent = await handoff.switchAgent('developer', 'database', {
    reason: 'User requested database operations'
  })

  // Now use databaseAgent as the active agent
  const result = await databaseAgent.execute({
    prompt: 'Create a users table'
  })
}
```

### Handoff Helper Methods

```typescript
const handoff = createHandoffHelpers(agents, config)

// Check if handoff is allowed
handoff.canHandoffTo(sourceId, targetId): boolean

// Get available handoff targets
handoff.getHandoffTargets(sourceId): AgentHandoffConfig[]

// Switch to another agent
handoff.switchAgent(sourceId, targetId, options): Promise<AgentWrapper | null>

// Get all available agents
handoff.getAvailableAgents(): string[]

// Check if agent exists
handoff.hasAgent(agentId): boolean
```

### Lifecycle Hooks

Add custom logic before and after handoffs:

```typescript
const handoff = createHandoffHelpers(agents, {
  beforeHandoff: async (context) => {
    console.log(`Switching from ${context.sourceAgentId} to ${context.targetAgentId}`)

    // Save current state
    await saveAgentState(context.sourceAgentId)

    // Validate handoff
    if (!isUserAuthorized(context.targetAgentId)) {
      return false // Cancel handoff
    }

    return true // Allow handoff
  },
  afterHandoff: async (context, success) => {
    if (success) {
      // Update UI
      updateActiveAgent(context.targetAgentId)

      // Log to analytics
      trackHandoff(context)

      // Notify user
      showNotification(`Switched to ${context.targetAgentId}`)
    }
  }
})
```

### Validation

By default, handoff helpers validate that the handoff is configured in the source agent's `handoffs` array. You can disable this:

```typescript
const handoff = createHandoffHelpers(agents, {
  validateHandoff: false // Allow any handoff
})
```

### Logging

Use the built-in logger helper:

```typescript
import { createHandoffHelpers, createHandoffLogger } from '@airo/ai-lib'

const logger = createHandoffLogger((message, data) => {
  console.log(`[HANDOFF] ${message}`, data)
})

const handoff = createHandoffHelpers(agents, {
  beforeHandoff: logger.beforeHandoff,
  afterHandoff: logger.afterHandoff
})
```

### Custom Validation

Create custom validators:

```typescript
import { createHandoffValidator } from '@airo/ai-lib'

const validator = createHandoffValidator((context) => {
  // Check user permissions
  if (context.targetAgentId === 'admin') {
    return currentUser.isAdmin
  }

  // Check business hours
  const hour = new Date().getHours()
  if (context.targetAgentId === 'support' && (hour < 9 || hour > 17)) {
    return false
  }

  return true
})

const handoff = createHandoffHelpers(factory, {
  beforeHandoff: validator
})
```

## When to Use Each

### Use Delegation When:
- An agent needs help from another agent
- You want the result back to continue processing
- The calling agent remains responsible for the task
- You're building autonomous agent workflows
- Example: "Developer agent asks database agent to create a schema"

### Use Handoff When:
- User explicitly switches between agents
- You're building a multi-agent chat interface
- Different agents handle different conversation phases
- You need to change the active agent in your UI
- Example: "User clicks 'Switch to Database Agent' button"

## Migration from Old "Handoff" Tool

If you were using the old `handoff` tool (now renamed to `delegate`):

### Update Imports

```typescript
// Old
import { createHandoffTool, addHandoffTools } from '@airo/ai-lib'

// New
import { createDelegateTool, addDelegationTools } from '@airo/ai-lib'
```

### Update Tool Names

```typescript
// Old
const tools = {
  ...addHandoffTools(factory, 'agentId')
}

// New
const tools = {
  ...addDelegationTools(factory, 'agentId')
}
```

### Update System Prompts

```typescript
// Old
system: 'Use the handoff tool to delegate tasks'

// New
system: 'Use the delegate tool to delegate tasks'
```

### Backward Compatibility

The old `addHandoffTools` function is still available but deprecated:

```typescript
// Still works, but deprecated
import { addHandoffTools } from '@airo/ai-lib'

const tools = {
  ...addHandoffTools(factory, 'agentId') // Internally calls addDelegationTools
}
```

## Complete Example

Here's a complete example showing both delegation and handoff:

```typescript
import {
  createAgentFactory,
  getModel,
  addDelegationTools,
  createHandoffHelpers,
  createHandoffLogger
} from '@airo/ai-lib'

async function main() {
  const factory = createAgentFactory()

  // Define agents
  const agents = factory.defineAgents({
    coordinator: {
      name: 'Coordinator',
      system: `You coordinate tasks. Use the delegate tool to ask specialists for help.`,
      model: await getModel('gpt4o'),
      tools: {
        ...addDelegationTools(factory, 'coordinator', true)
      },
      handoffs: [
        { agentName: 'developer', description: 'Development tasks' },
        { agentName: 'database', description: 'Database operations' }
      ]
    },
    developer: {
      name: 'Developer',
      system: 'You handle development tasks',
      model: await getModel('gpt4o'),
      tools: {
        ...addDelegationTools(factory, 'developer', true)
      },
      handoffs: [
        { agentName: 'database', description: 'Database operations' }
      ]
    },
    database: {
      name: 'Database Agent',
      system: 'You handle database operations',
      model: await getModel('gpt4o'),
      tools: {},
      handoffs: []
    }
  })

  // Create handoff helpers for agent switching
  const logger = createHandoffLogger(console.log)
  const handoff = createHandoffHelpers(agents, {
    beforeHandoff: logger.beforeHandoff,
    afterHandoff: logger.afterHandoff
  })

  // Track current agent
  let currentAgent = agents.get('coordinator')

  // Example 1: Coordinator delegates to developer (delegation)
  console.log('=== Delegation Example ===')
  const delegationResult = await currentAgent.execute({
    prompt: 'Please delegate the task of creating a REST API to the developer agent'
  })
  console.log('Delegation result:', delegationResult)

  // Example 2: User switches to developer agent (handoff)
  console.log('\n=== Handoff Example ===')
  currentAgent = await handoff.switchAgent('coordinator', 'developer', {
    reason: 'User wants to work directly with developer agent'
  })

  // Now developer is the active agent
  const devResult = await currentAgent.execute({
    prompt: 'Create a users API endpoint'
  })
  console.log('Developer result:', devResult)

  // Example 3: Developer delegates to database (delegation)
  console.log('\n=== Nested Delegation Example ===')
  const nestedResult = await currentAgent.execute({
    prompt: 'Delegate database schema creation to the database agent'
  })
  console.log('Nested delegation result:', nestedResult)
}

main()
```

## Best Practices

1. **Use delegation for agent-to-agent communication**: When agents need to work together autonomously
2. **Use handoff for user-initiated switches**: When users explicitly want to change agents
3. **Always provide clear reasons**: Include `reason` in both delegations and handoffs for debugging
4. **Implement proper validation**: Use `beforeHandoff` hooks to validate permissions and state
5. **Track state changes**: Use `afterHandoff` hooks to update UI and save state
6. **Configure handoff permissions**: Use the `handoffs` array to explicitly define allowed transitions
7. **Use delegation history**: Enable history tools to help agents learn from past interactions

## See Also

- [Agent Factory Guide](./agent-factory.md)
- [Tool Creation Guide](./tools.md)
- [Examples](../examples/)
  - [handoff-helpers-example.ts](../examples/handoff-helpers-example.ts)
  - [agent-handoff-demo.ts](../examples/agent-handoff-demo.ts)
