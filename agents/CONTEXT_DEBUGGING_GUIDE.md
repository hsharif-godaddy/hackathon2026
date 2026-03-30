# Context Debugging Guide

## 🔍 Comprehensive Context Debugging Implementation

This guide shows all the debugging points added to track context improvements throughout the system.

## 📊 Debugging Levels

### **Level 1: Frontend Context Capture**
**Location**: `app/src/app/develop/components/useStreamingWebSocket.ts`

```typescript
console.log('📸 Capturing visual context from iframe...')
const visualContext = await captureVisualContext()

console.log('📤 Sending message with rich context:', {
  messageLength: content.length,
  hasAiEditContext: !!aiEditContext,
  hasVisualContext: !!visualContext,
  conversationId,
  contextKeys: Object.keys(richContext),
  visualContextDetails: visualContext ? {
    page: visualContext.page,
    activeSection: visualContext.active_section,
    scrollY: visualContext.scroll_position.y
  } : null
})
```

**What it shows:**
- Visual context capture from iframe
- Rich context object composition
- AI Edit context availability
- Visual context details (page, section, scroll position)

### **Level 2: Context Conversion (Simplified)**
**Location**: `agents/src/server/conversation-websocket-wrapper.ts`

```typescript
console.log('📋 Converting raw context to enhanced context (all sections enabled):', {
  originalContextKeys: Object.keys(rawContext).filter(key => rawContext[key]),
  hasMetadata: !!rawContext.metadata,
  hasConversation: !!rawContext.conversation,
  hasAppContext: !!rawContext.appContext,
  hasAiEditContext: !!rawContext.aiEditContext,
  hasVisualContext: !!rawContext.visualContext
})
```

**What it shows:**
- **Simplified context processing** (no optimization complexity)
- **All available context** is always included
- **Context availability flags** for each section
- **No filtering or optimization** - everything is enabled

### **Level 3: Context Messages Building (Static System Prompt)**
**Location**: `agents/src/agents/ai-lib-agents/context-manager.ts`

```typescript
console.log('🎨 Building context messages (keeping system prompt static):', {
  hasMetadata: !!context.metadata,
  hasConversation: !!context.conversation,
  hasAppContext: !!context.appContext,
  hasAiEditContext: !!context.aiEditContext,
  hasVisualContext: !!context.visualContext,
  conversationMaxMessages: context.conversation?.maxMessages,
  appContextDepth: context.appContext?.maxDirectoryDepth
})

console.log('📋 Generated context messages:', {
  totalMessages: contextMessages.length,
  messageTypes: contextMessages.map(msg => msg.type),
  totalContextLength: contextMessages.reduce((sum, msg) => sum + msg.content.length, 0)
})

console.log('✅ Context messages built:', {
  staticSystemPromptLength: baseSystemPrompt.length,
  contextMessagesCount: conversationContextMessages.length,
  totalContextLength: conversationContextMessages.reduce((sum, msg) => sum + msg.content.length, 0)
})
```

**What it shows:**
- Context availability flags
- Context message generation details
- Static system prompt length (unchanged)
- Context messages count and total length

### **Level 4: Agent Creation (Dynamic Logging)**
**Location**: `agents/src/agents/ai-lib-agents/index.ts`

```typescript
console.log(`🤖 Creating ${agentType} agent with static system prompt + context messages:`, {
  agentType,
  agentName: agentConfig.name,
  staticSystemPromptLength: systemPrompt.length,
  contextMessagesCount: contextMessages.length,
  totalContextLength: contextMessages.reduce((sum, msg) => sum + msg.content.length, 0),
  modelType: typeof model === 'string' ? model : model.constructor.name,
  toolsAvailable: Object.keys(agentConfig.tools).length,
  toolNames: Object.keys(agentConfig.tools)
})
```

**What it shows:**
- **Dynamic agent type** (develop, example, database, color-scheme)
- **Dynamic agent name** from actual config
- Static system prompt length (unchanged)
- Context messages count and total length
- **Dynamic model type** detection (string or constructor name)
- **Dynamic tools count** from actual agent config
- **Dynamic tool names** list from actual agent config

### **Level 5: LLM Call Details**
**Location**: `packages/ai-lib/src/core/agent.ts`

```typescript
console.log('🚀 Starting streamText with options:', {
  model: typeof streamOptions.model,
  messageCount: streamOptions.messages.length,
  temperature: streamOptions.temperature,
  maxOutputTokens: streamOptions.maxOutputTokens,
  hasTools: !!streamOptions.tools,
  toolCount: streamOptions.tools ? Object.keys(streamOptions.tools).length : 0
})

console.log('📝 LLM Context Details:', {
  systemPromptLength: streamOptions.messages.find(m => m.role === 'system')?.content?.length || 0,
  userMessagesCount: streamOptions.messages.filter(m => m.role === 'user').length,
  assistantMessagesCount: streamOptions.messages.filter(m => m.role === 'assistant').length,
  totalContentLength: streamOptions.messages.reduce((sum, msg) => 
    sum + (typeof msg.content === 'string' ? msg.content.length : 0), 0
  )
})

console.log('🎨 System Prompt Context Analysis:', {
  hasProjectContext: contextStart !== -1,
  hasVisualContext: visualStart !== -1,
  hasEditContext: editStart !== -1,
  systemPromptPreview: systemContent.substring(0, 200) + '...',
  contextSections: {
    projectContext: contextStart !== -1 ? `Found at position ${contextStart}` : 'Not found',
    visualContext: visualStart !== -1 ? `Found at position ${visualStart}` : 'Not found',
    editContext: editStart !== -1 ? `Found at position ${editStart}` : 'Not found'
  }
})
```

**What it shows:**
- LLM call configuration (model, temperature, tokens)
- Message composition (system, user, assistant counts)
- Total content length being sent to LLM
- Context section detection in system prompt
- System prompt preview

## 🎯 Key Debugging Insights

### **Message Type Classification**
The system analyzes messages and classifies them as:
- `code` - Code-related questions/requests
- `ui` - UI/design related questions
- `file` - File operations
- `question` - General project questions
- `follow-up` - Continuation of previous conversation
- `element-reference` - References to specific UI elements
- `general` - Default classification

### **Context Relevance Scores**
Each context type gets a 0-1 relevance score:
- **App Context**: Project structure, package info
- **Visual Context**: Current page state, scroll position
- **AI Edit Context**: Selected element information
- **Conversation History**: Previous messages

### **Smart Optimizations**
The system can make these optimizations:
- `excluded-app-context` - Removed app context (not relevant)
- `excluded-visual-context` - Removed visual context
- `excluded-ai-edit-context` - Removed AI edit context
- `adjusted-history-N` - Changed conversation history to N messages
- `adjusted-depth-N` - Changed directory depth to N levels
- `no-changes` - No optimizations needed

### **Context Sections Detected**
The system looks for these sections in the final system prompt:
- `## Current Project Context` - App/project information
- `## User Visual Context` - Visual state information
- `## Selected Element Context` - AI edit context

## 🚀 Usage

When you send a message through the system, you'll see a complete debugging trace showing:

1. **Frontend**: Context capture and composition
2. **Smart Manager**: Message analysis and optimization
3. **Context Manager**: System prompt enhancement
4. **Agent Creation**: Agent configuration
5. **LLM Call**: Final context sent to the model

This gives you complete visibility into how the context system is working and what optimizations are being applied based on your message content.

## 📈 Performance Monitoring

The debugging also shows:
- **Context Size**: Estimated character count
- **Context Percentage**: How much of the prompt is context vs base
- **Optimization Impact**: What changes were made and why
- **Message Analysis**: How the system interpreted your message

This comprehensive debugging system allows you to see exactly how the smart context management is improving the AI's understanding of your requests!

## 🎯 **IMPORTANT: Static System Prompt Architecture**

**Key Change**: The system now uses a **static system prompt** with **dynamic context messages** instead of modifying the system prompt. This is a much cleaner architecture:

### **Before (❌ Old Way)**:
- System prompt was modified with dynamic context
- Context was embedded directly into the system prompt
- System prompt changed for every request

### **After (✅ New Way)**:
- System prompt remains static and unchanged
- Context is passed as separate messages in the conversation
- Much cleaner separation of concerns
- Better debugging and maintainability

### **Message Flow**:
1. **Static System Prompt**: Base agent instructions (never changes)
2. **Context Messages**: Dynamic context as separate system messages
3. **Conversation History**: Previous user/assistant messages
4. **Current User Message**: The new user input

This architecture follows LLM best practices and makes the system much more maintainable and debuggable!

## 🔄 **Latest Updates: Dynamic Logging & Claude Sonnet 4**

### **🎯 Dynamic Logging Implementation**
The debug logging is now **completely dynamic** and based on actual agent configurations instead of hardcoded lists:

**Before (❌ Static Lists):**
```typescript
toolsAvailable: 15  // Hardcoded number
modelType: 'gpt-4o-mini'  // Hardcoded string
```

**After (✅ Dynamic Detection):**
```typescript
modelType: typeof model === 'string' ? model : model.constructor.name,
toolsAvailable: Object.keys(agentConfig.tools).length,
toolNames: Object.keys(agentConfig.tools)
```

### **🧠 Model Support**
All agents use **GoCode** configured AI models for:
- Better reasoning capabilities
- Improved code generation
- Enhanced context understanding
- More reliable tool usage

### **🏗️ Centralized Agent Configuration**
New `createAgentConfigWithLogging()` helper function:
- **Eliminates code duplication** across agent factories
- **Ensures consistent logging** for all agents
- **Dynamic tool detection** prevents outdated debug info
- **Automatic model type detection** works with any model

### **📊 Enhanced Debug Information**
The logging now shows:
- **Agent Name**: From actual config (not hardcoded)
- **Tool Names**: Complete list of available tools
- **Model Type**: Dynamically detected
- **Context Details**: Real-time context message analysis

This ensures the debugging information is **always accurate** and **never gets out of sync** with the actual agent configurations! 🎉

## 🎯 **Context Simplification: All Sections Enabled**

### **🔄 Latest Change: Removed Smart Context Optimization**
The complex smart context optimization has been **removed** in favor of a much simpler approach:

**Before (❌ Complex Optimization):**
- Message analysis and classification
- Relevance scoring (0-1 for each context type)
- Dynamic context inclusion/exclusion
- Strategy-based optimization
- Complex debugging with optimization details

**After (✅ Simple & Reliable):**
- **All available context sections are always included**
- **No complex analysis or filtering**
- **Predictable and consistent behavior**
- **Simpler debugging output**
- **Reduced complexity and potential bugs**

### **📋 New Context Flow:**
1. **Frontend** captures all available context (visual, AI edit, app, conversation)
2. **Simple conversion** from raw context to enhanced context format
3. **All sections enabled** - no filtering or optimization
4. **Context messages built** with all available information
5. **Agent created** with complete context

### **✅ Benefits of Simplification:**
- **🎯 Predictable**: Always includes all available context
- **🐛 Fewer Bugs**: No complex optimization logic to fail
- **🔍 Easier Debugging**: Simpler, more straightforward logging
- **⚡ Better Performance**: No analysis or scoring overhead
- **🧠 Better AI Results**: More context = better understanding

The system now follows the principle: **"When in doubt, include more context rather than less"** - which typically leads to better AI responses! 🚀
