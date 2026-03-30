---
status: completed
---

# WebSocket Schema Migration

This document describes the migration from the old WebSocket message format to the new normalized event schema.

## 🔄 **What Changed**

### **1. Removed `streamWithContext` Method**
- ❌ **Old**: Used `agent.streamWithContext()` which is being deprecated
- ✅ **New**: Uses `agent.streamGenerate()` for consistent API

### **2. Normalized Event Schema**
- ❌ **Old**: Custom event types like `chat_chunk`, `chat_complete`
- ✅ **New**: Standardized event types: `step_start`, `chunk`, `step_complete`, `complete`, etc.

### **3. Multi-Agent Support**
- ✅ **New**: Added `agents_available` event on connection
- ✅ **New**: Support for both `agentId` and `agentName` in messages
- ✅ **New**: `get_agents` event to refresh agent list

## 📋 **Event Schema Comparison**

### **Before (Old Schema)**
```javascript
// Text streaming
{ type: 'chat_chunk', content: 'Hello', data: {} }

// Completion  
{ type: 'chat_complete', content: 'Hello world', data: { agentName: '...', usage: {} } }

// Error
{ type: 'error', content: 'Error message', data: { timestamp: '...' } }
```

### **After (New Schema)**
```javascript
// Agent list on connection
{ type: 'agents_available', content: '', data: { agents: [...], defaultAgent: '...' } }

// Step start
{ type: 'step_start', content: '', data: { step: 1, stepType: 'reasoning' } }

// Text streaming
{ type: 'chunk', content: 'Hello', data: { step: 1, source: 'ai_response' } }

// Step completion
{ type: 'step_complete', content: 'Hello world', data: { step: 1, isFinal: true, toolCalls: [], usage: {} } }

// Final completion
{ type: 'complete', content: 'Hello world', data: { totalSteps: 1, agentId: 'assistant', usage: {}, toolCalls: [] } }

// Error
{ type: 'error', content: 'Error message', data: { timestamp: '...', agentId: '...' } }
```

## 🔧 **Client Migration Guide**

### **Before (Old Client Code)**
```javascript
const socket = io('http://localhost:3000')

socket.emit('chat', { message: 'Hello' })

socket.on('message', (data) => {
  if (data.type === 'chat_chunk') {
    // Handle streaming text
    appendToChat(data.content)
  } else if (data.type === 'chat_complete') {
    // Handle completion
    console.log('Done:', data.data.agentName)
  }
})
```

### **After (New Client Code)**
```javascript
const socket = io('http://localhost:3000')

// Send message (supports both agentId and agentName)
socket.emit('chat', { 
  message: 'Hello',
  agentId: 'assistant'  // or agentName: 'assistant'
})

// Handle normalized events
socket.on('message', (data) => {
  switch(data.type) {
    case 'agents_available':
      // List of available agents
      updateAgentList(data.data.agents)
      break
      
    case 'step_start':
      // New reasoning step started
      showStepIndicator(data.data.step)
      break
      
    case 'chunk':
      // Stream text content (same as old chat_chunk)
      appendToChat(data.content)
      break
      
    case 'tool_start':
      // Tool execution started
      showToolStatus(data.data.tool.name, 'running')
      break
      
    case 'tool_result':
      // Tool execution completed
      showToolStatus(data.data.tool.name, 'completed')
      break
      
    case 'step_complete':
      // Step finished
      hideStepIndicator(data.data.step)
      break
      
    case 'complete':
      // Everything finished (same as old chat_complete)
      console.log('Done:', data.data.agentId)
      console.log('Usage:', data.data.usage)
      break
      
    case 'error':
      // Error occurred
      showError(data.content)
      break
  }
})

// Get available agents
socket.emit('get_agents')
```

## 🎯 **Key Benefits**

### **1. Standardized Events**
- **Consistent structure**: All events have `type`, `content`, `data`
- **Predictable handling**: Same event types across all agent interactions
- **Rich metadata**: Step numbers, sources, tool information

### **2. Better Multi-Agent Support**
- **Agent discovery**: Automatic agent list on connection
- **Flexible addressing**: Support both `agentId` and `agentName`
- **Agent metadata**: Names, descriptions, default agent

### **3. Enhanced Tool Support**
- **Tool lifecycle**: `tool_start` and `tool_result` events
- **Tool metadata**: Input parameters, execution results
- **Tool content**: Tool outputs flow through `chunk` events

### **4. Improved Error Handling**
- **Contextual errors**: Include agent information in error events
- **Consistent format**: All errors follow same schema
- **Better debugging**: More metadata for troubleshooting

## 🔄 **Migration Steps**

### **1. Update Server Code**
```typescript
// Before
import { createSingleAgentWebSocketServer } from '@airo/ai-lib'

// After - same import, new schema automatically
import { createSingleAgentWebSocketServer } from '@airo/ai-lib'
```

### **2. Update Client Event Handlers**
- Replace `chat_chunk` → `chunk`
- Replace `chat_complete` → `complete`
- Add handlers for new events: `agents_available`, `step_start`, `step_complete`
- Add agent selection using `agentId`

### **3. Test Multi-Agent Features**
```javascript
// Get available agents
socket.emit('get_agents')

// Use specific agent
socket.emit('chat', { message: 'Help me code', agentId: 'technical' })
```

## 📊 **Schema Compliance**

The new WebSocket server now fully complies with the normalized event schema defined in `WEBSOCKET-EVENT-SCHEMA.md`:

- ✅ **All events** have consistent `type`, `content`, `data` structure
- ✅ **All renderable content** flows through `chunk` events
- ✅ **Tool events** provide metadata and status
- ✅ **Step tracking** with `step_start` and `step_complete`
- ✅ **Multi-agent support** with `agents_available`
- ✅ **Backward compatibility** maintained where possible

## 🚀 **Ready for Production**

The updated WebSocket server provides:
- **Modern event schema** for consistent client handling
- **Better performance** with streamlined agent management
- **Enhanced features** like multi-agent support and tool tracking
- **Future-proof design** that scales with new agent capabilities

Migration is straightforward and maintains backward compatibility for core functionality while adding powerful new features! 🎉
