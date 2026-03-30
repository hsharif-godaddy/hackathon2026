# Handoff State Manager

The `SessionStateManager` (created via `createSessionStateManager`) provides a default implementation for tracking which agent is currently handling each session. This is essential for the handoff tool to work properly in multi-agent applications.

## Overview

When agents use the handoff tool to switch control, the state manager:
1. Tracks which agent is currently active for each session
2. Records handoff history (who handed off to whom, when, and why)
3. Automatically cleans up expired sessions
4. Provides statistics and debugging information

## Basic Usage

```typescript
import { 
  createSessionStateManager,
  createHandoffTool,
  createAgentFactory,
  getModel
} from '@airo/ai-lib'

// Create state manager
const stateManager = createSessionStateManager({
  defaultAgentId: 'coordinator',
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  enableLogging: true
})

// Create agents
const factory = createAgentFactory()
const agents = factory.defineAgents({
  coordinator: {
    name: 'Coordinator',
    system: 'Use handoff tool to switch to specialists',
    model: await getModel('gpt4o'),
    tools: {
      handoff: createHandoffTool({
        sourceAgentId: 'coordinator',
        validTargets: ['developer'],
        stateManager,
        sessionId: 'user-session-123'
      })
    },
    handoffs: [
      { agentName: 'developer', description: 'Development tasks' }
    ]
  },
  developer: {
    name: 'Developer',
    system: 'Handle development tasks',
    model: await getModel('gpt4o'),
    tools: {},
    handoffs: []
  }
})

// Initialize session
const sessionId = 'user-session-123'
stateManager.getOrCreateSession(sessionId, 'coordinator')

// When agent uses handoff tool, state manager automatically tracks the switch
const result = await agents.get('coordinator').generate(
  'I need help with a coding task'
)

// Check which agent is now active
const currentAgent = stateManager.getCurrentAgent(sessionId)
console.log(`Current agent: ${currentAgent}`) // 'developer'
```

## Configuration Options

```typescript
interface SessionStateManagerConfig {
  /** Default agent ID for new sessions */
  defaultAgentId?: string

  /** Session timeout in milliseconds (default: 1 hour) */
  sessionTimeout?: number

  /** Whether to log handoff events (default: true) */
  enableLogging?: boolean

  /** Callback when agent switches */
  onAgentSwitch?: (
    sessionId: string,
    fromAgentId: string,
    toAgentId: string,
    prompt?: string
  ) => void

  /** Callback when todo list is selected */
  onTodoListSelect?: (sessionId: string, todoListId: string) => void
}
```

## API Reference

### `switchAgent(sessionId, targetAgentId, prompt?)`

Switch the active agent for a session.

```typescript
await stateManager.switchAgent('session-123', 'developer', 'User needs coding help')
// Returns: true if successful
```

### `getCurrentAgent(sessionId)`

Get the current agent for a session.

```typescript
const agentId = stateManager.getCurrentAgent('session-123')
// Returns: 'developer' or undefined
```

### `getOrCreateSession(sessionId, agentId?)`

Get or create a session with a default agent.

```typescript
const currentAgent = stateManager.getOrCreateSession('session-123', 'coordinator')
// Returns: current agent ID for the session
```

### `getSessionHistory(sessionId)`

Get handoff history for a session.

```typescript
const history = stateManager.getSessionHistory('session-123')
// Returns: Array of handoff events
// [
//   {
//     fromAgentId: 'coordinator',
//     toAgentId: 'developer',
//     prompt: 'User needs coding help',
//     timestamp: Date
//   }
// ]
```

### `getActiveSessions()`

Get all active session IDs.

```typescript
const sessions = stateManager.getActiveSessions()
// Returns: ['session-123', 'session-456', ...]
```

### `getSessionCount()`

Get number of active sessions.

```typescript
const count = stateManager.getSessionCount()
// Returns: 42
```

### `getStats()`

Get statistics about the state manager.

```typescript
const stats = stateManager.getStats()
// Returns: {
//   totalSessions: 42,
//   oldestSession: Date,
//   newestSession: Date,
//   totalHandoffs: 156
// }
```

### `clearSession(sessionId)`

Clear a specific session.

```typescript
stateManager.clearSession('session-123')
```

### `clearAllSessions()`

Clear all sessions.

```typescript
stateManager.clearAllSessions()
```

### `stopCleanup()`

Stop automatic cleanup of expired sessions.

```typescript
stateManager.stopCleanup()
```

## WebSocket Integration

In a WebSocket application, you would typically:

1. Create one state manager instance for the server
2. Pass it to all handoff tools
3. Use socket ID as session ID
4. Check current agent before processing messages

```typescript
import { createWebSocketServer } from '@airo/ai-transport'

const stateManager = createSessionStateManager({
  defaultAgentId: 'coordinator'
})

// When creating agents for WebSocket
const agents = factory.defineAgents({
  coordinator: {
    // ... config
    tools: {
      handoff: createHandoffTool({
        sourceAgentId: 'coordinator',
        validTargets: ['developer'],
        stateManager,
        sessionId: socket.id // Use socket ID as session ID
      })
    }
  }
})

// Before processing message, check which agent should handle it
socket.on('chat_message', async (data) => {
  const currentAgentId = stateManager.getCurrentAgent(socket.id) || 'coordinator'
  const agent = agents.get(currentAgentId)
  
  // Process with current agent
  const result = await agent.generate(data.message)
  socket.emit('response', result)
})
```

## Session Lifecycle

1. **Creation**: Session created when first message arrives or via `getOrCreateSession()`
2. **Activity**: `lastActivityAt` updated on every handoff
3. **Expiration**: Sessions expire after `sessionTimeout` (default: 1 hour)
4. **Cleanup**: Automatic cleanup runs every 5 minutes to remove expired sessions

## Monitoring and Debugging

### Enable Logging

```typescript
const stateManager = createSessionStateManager({
  enableLogging: true
})

// Logs will show:
// Handoff: coordinator -> developer (session: session-123)
//    Prompt: User needs coding help
// Created new session session-456 with agent: coordinator
// Cleaned up 3 expired sessions
```

### Custom Callbacks

```typescript
const stateManager = createSessionStateManager({
  onAgentSwitch: (sessionId, from, to, prompt) => {
    // Log to analytics
    analytics.track('agent_handoff', {
      session: sessionId,
      from,
      to,
      prompt
    })
    
    // Update UI
    notifyUser(`Switching to ${to} agent`)
  }
})
```

### Statistics Dashboard

```typescript
setInterval(() => {
  const stats = stateManager.getStats()
  console.log('📊 State Manager Stats:', {
    sessions: stats.totalSessions,
    handoffs: stats.totalHandoffs,
    oldestSession: stats.oldestSession?.toISOString()
  })
}, 60000) // Every minute
```

## Production Considerations

The in-memory state manager is suitable for:
- ✅ Single-process applications
- ✅ Development and testing
- ✅ Prototyping

For production multi-process/distributed systems, consider implementing a custom `HandoffStateManager` backed by:
- Redis (for distributed state)
- Database (for persistence)
- Message queue (for event-driven architecture)

### Custom Implementation Example

```typescript
import type { HandoffStateManager } from '@airo/ai-lib'
import Redis from 'ioredis'

class RedisHandoffStateManager implements HandoffStateManager {
  private redis: Redis
  
  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl)
  }
  
  async switchAgent(
    sessionId: string,
    targetAgentId: string,
    prompt?: string
  ): Promise<boolean> {
    await this.redis.set(
      `session:${sessionId}:agent`,
      targetAgentId,
      'EX',
      3600 // 1 hour expiry
    )

    // Store history
    await this.redis.rpush(
      `session:${sessionId}:history`,
      JSON.stringify({
        targetAgentId,
        prompt,
        timestamp: new Date().toISOString()
      })
    )
    
    return true
  }
  
  async getCurrentAgent(sessionId: string): Promise<string | undefined> {
    return await this.redis.get(`session:${sessionId}:agent`) || undefined
  }
}

// Use custom implementation
const stateManager = new RedisHandoffStateManager('redis://localhost:6379')
```

## Best Practices

1. **Session IDs**: Use stable identifiers (socket ID, user ID, conversation ID)
2. **Cleanup**: Call `stopCleanup()` when shutting down to prevent memory leaks
3. **Monitoring**: Track handoff statistics for insights into agent usage
4. **Timeouts**: Adjust `sessionTimeout` based on your application's needs
5. **Logging**: Enable logging in development, use callbacks in production
6. **Error Handling**: Always check if `getCurrentAgent()` returns undefined

## Troubleshooting

### Session not found
```typescript
const currentAgent = stateManager.getCurrentAgent('session-123')
if (!currentAgent) {
  // Session expired or never created
  stateManager.getOrCreateSession('session-123', 'coordinator')
}
```

### Handoff not working
```typescript
// Check if handoff is configured
const coordinator = agents.get('coordinator')
const handoffs = coordinator.getConfig().handoffs
console.log('Available handoffs:', handoffs)

// Verify state manager is passed to tool
const tool = createHandoffTool({
  sourceAgentId: 'coordinator',
  validTargets: ['developer'],
  stateManager, // Must be provided!
  sessionId: 'session-123'
})
```

### Memory leaks
```typescript
// Always stop cleanup when shutting down
process.on('SIGTERM', () => {
  stateManager.stopCleanup()
  stateManager.clearAllSessions()
})
```

