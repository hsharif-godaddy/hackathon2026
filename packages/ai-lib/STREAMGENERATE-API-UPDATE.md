# StreamGenerate API Update

## 🔄 **Changes Made**

### **Removed `streamWithContext` Method**
- ❌ **Old**: `agent.streamWithContext(prompt, { customContext, conversationHistory })`
- ✅ **New**: `agent.streamGenerate(prompt, { customContext, messages, appState })`

### **Enhanced `streamGenerate` Options**

The `streamGenerate` method now supports flexible context injection through enhanced options:

```typescript
async streamGenerate(prompt: string, options?: {
  /** Previous conversation messages */
  messages?: Array<{ role: 'user' | 'assistant', content: string }>
  /** Custom context data (for legacy compatibility) */
  context?: Record<string, any>
  /** Custom context string to inject before the prompt */
  customContext?: string
  /** App state to inject as structured context */
  appState?: Record<string, any>
})
```

## 📋 **Migration Guide**

### **Before (streamWithContext)**
```typescript
const streamResult = await agent.streamWithContext(userMessage, {
  customContext: `[SYSTEM CONTEXT]\nUser preferences: ${JSON.stringify(preferences)}\nCurrent state: active`,
  conversationHistory: [
    { role: 'user', content: 'Previous question' },
    { role: 'assistant', content: 'Previous answer' }
  ]
})

// Generator-style iteration
for await (const chunk of streamResult) {
  process.stdout.write(chunk)
}

// Final result from generator return
const finalResult = await streamResult.return()
```

### **After (streamGenerate)**
```typescript
const streamResult = await agent.streamGenerate(userMessage, {
  customContext: `[SYSTEM CONTEXT]\nUser preferences: ${JSON.stringify(preferences)}\nCurrent state: active`,
  messages: [
    { role: 'user', content: 'Previous question' },
    { role: 'assistant', content: 'Previous answer' }
  ]
})

// Stream iteration
for await (const chunk of streamResult.textStream) {
  process.stdout.write(chunk)
}

// Final result from method
const finalResult = await streamResult.getFinalResult()
```

### **New Options for Better Context Handling**

#### **1. App State Injection**
```typescript
const streamResult = await agent.streamGenerate(prompt, {
  appState: {
    user: { id: '123', preferences: { theme: 'dark' } },
    session: { authenticated: true },
    context: { page: 'dashboard' }
  }
})
```

#### **2. Custom Context String**
```typescript
const streamResult = await agent.streamGenerate(prompt, {
  customContext: `[CURRENT APP STATE]
User: John Doe (Premium member)
Location: New York
Time: ${new Date().toLocaleString()}
Active Features: chat, recommendations, booking

Please use this context when responding.`
})
```

#### **3. Conversation History**
```typescript
const streamResult = await agent.streamGenerate(prompt, {
  messages: conversationHistory.getRecentMessages(6)
})
```

#### **4. Combined Context**
```typescript
const streamResult = await agent.streamGenerate(prompt, {
  customContext: `[SYSTEM INFO]\nCurrent weather: ${weatherData}`,
  appState: userPreferences,
  messages: conversationHistory
})
```

## 🎯 **Benefits**

### **1. Simplified API**
- **Single method** for all streaming scenarios
- **Consistent return format** with `textStream` and `getFinalResult()`
- **No generator complexity** - simpler iteration and result handling

### **2. Better Context Control**
- **Multiple context injection methods** for different use cases
- **Structured app state** vs **custom context strings**
- **Automatic JSON formatting** for app state

### **3. Enhanced Flexibility**
- **Mix and match options** as needed
- **Legacy compatibility** with `context` parameter
- **Clear separation** between conversation history and context

### **4. Consistent Integration**
- **Same API** across all ExperimentalAgentWrapper instances
- **WebSocket server compatibility** - no special handling needed
- **Tool chain support** - works seamlessly with agentic workflows

## 🔧 **Updated Examples**

### **Basic Context Injection**
```typescript
// Simple context string
const result = await agent.streamGenerate('Help me plan my day', {
  customContext: 'User is in Tokyo, weather is sunny, budget is medium'
})
```

### **Rich App State**
```typescript
// Structured app state
const result = await agent.streamGenerate('What should I do today?', {
  appState: {
    user: { location: 'Tokyo', preferences: ['food', 'culture'] },
    weather: { condition: 'sunny', temp: 25 },
    time: { local: '2:30 PM', timezone: 'Asia/Tokyo' }
  }
})
```

### **Multi-turn Conversation**
```typescript
// With conversation history
const result = await agent.streamGenerate('Continue our discussion', {
  messages: [
    { role: 'user', content: 'I need travel advice for Tokyo' },
    { role: 'assistant', content: 'I\'d be happy to help! What are you interested in?' },
    { role: 'user', content: 'Food and cultural experiences' }
  ]
})
```

## 🚀 **Real-world Usage**

The enhanced `streamGenerate` is now used throughout the codebase:

- ✅ **WebSocket Server** - Uses `streamGenerate` for all streaming
- ✅ **Agentic Examples** - Updated to use new context options
- ✅ **Agent Factory** - Consistent API across all agents

### **Production Example**
```typescript
// Travel planning app
const planningResult = await travelAgent.streamGenerate(
  'Plan my itinerary for tomorrow',
  {
    appState: {
      user: getUserProfile(),
      trip: getTripDetails(),
      preferences: getUserPreferences()
    },
    customContext: `Weather forecast: ${await getWeatherForecast()}`,
    messages: getConversationHistory()
  }
)

// Stream the response
for await (const chunk of planningResult.textStream) {
  sendToClient(chunk)
}

// Get final metadata
const { usage, toolCalls } = await planningResult.getFinalResult()
logUsage(usage)
```

This update provides a more flexible, powerful, and consistent API for all streaming agent interactions! 🎉
