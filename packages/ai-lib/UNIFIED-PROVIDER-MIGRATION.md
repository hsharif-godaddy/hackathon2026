# Unified Provider Migration

This document describes the migration from the old provider system to the new unified provider helper.

## 🔄 **What Changed**

### **Removed Files**

- ❌ `src/providers/openai.ts` - Old OpenAI provider helpers
- ❌ `src/providers/provider-config.ts` - Complex provider registry system

### **Added Files**

- ✅ `src/providers/unified-provider.ts` - New unified provider system

## 🚀 **New Unified Provider Features**

### **1. Single Interface for All Providers**

```typescript
import { getModel } from "@airo/ai-lib";

// OpenAI models
const gpt4 = await getModel("gpt4o");
const gpt4Mini = await getModel("gpt4o-mini");
```

### **2. Short, Memorable Model Names**

```typescript
// Instead of: 'gpt-4o-mini'
const gpt = await getModel("gpt4o-mini");
```

### **3. Automatic Environment Validation**

```typescript
// Validates environment before model creation
try {
  const model = await getModel("gpt4o");
} catch (error) {
  // Clear error messages about missing API keys
}
```

### **4. Built-in OpenAI Proxy Support**

```typescript
// Automatically detects and uses OPENAI_BASE_URL
const model = await getModel("gpt4o"); // Uses proxy if configured

// Or specify proxy explicitly
const model = await getModel("gpt4o", {
  openaiBaseUrl: "https://proxy.example.com",
});
```

## 📋 **Available Model Names**

### **OpenAI Models**

| Short Name   | Full Name       | Provider |
| ------------ | --------------- | -------- |
| `gpt4o`      | `gpt-4o`        | openai   |
| `gpt4o-mini` | `gpt-4o-mini`   | openai   |
| `gpt4`       | `gpt-4`         | openai   |
| `gpt35`      | `gpt-3.5-turbo` | openai   |

## 🔧 **Migration Guide**

### **Before (Old Provider System)**

```typescript
import { createOpenAI } from "@ai-sdk/openai";

// Complex setup for providers
const openaiProvider = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
});
const gpt = openaiProvider("gpt-4o");
```

### **After (Unified Provider)**

```typescript
import { getModel } from "@airo/ai-lib";

// Simple, consistent interface
const gpt = await getModel("gpt4o"); // Automatic proxy support
```

### **Updated Examples**

All examples have been updated to use the unified provider:

- ✅ `basic-openai.ts` - Uses `getModel('gpt4o-mini')` etc.

## 🛠️ **Utility Functions**

```typescript
import {
  getAvailableModels,
  isModelSupported,
  getFullModelName,
  validateModelEnvironment,
  getModelInfo,
} from "@airo/ai-lib";

// List all available model short names
const models = getAvailableModels();
// ['gpt4o', 'gpt4o-mini', 'gpt4', 'gpt35', ...]

// Check if a model is supported
const isSupported = isModelSupported("gpt4o"); // true

// Get full model identifier from short name
const fullName = getFullModelName("gpt4o");
// 'gpt-4o'

// Validate environment for a model
const isValid = validateModelEnvironment("gpt4o"); // true/false

// Get detailed model information
const info = getModelInfo("gpt4o");
// { shortName: 'gpt4o', fullName: 'gpt-4o', provider: 'openai', isSupported: true }
```

## ✅ **Benefits**

1. **Simplified API** - One function for all providers
2. **Better UX** - Short, memorable model names
3. **Automatic Validation** - Environment checks before model creation
4. **Built-in Proxy Support** - OpenAI proxy detection and configuration
5. **Type Safety** - Full TypeScript support
6. **Consistent Interface** - Same API regardless of provider
7. **Error Handling** - Clear error messages for configuration issues

## 🚀 **Usage in Agent Factory**

The unified provider works seamlessly with the AgentFactory:

```typescript
import { getModel } from "@airo/ai-lib";
import { createAgentFactory } from "@airo/ai-lib";

const agentFactory = createAgentFactory();

const agents = agentFactory.defineAgents({
  openaiAgent: {
    name: "OpenAI Assistant",
    model: await getModel("gpt4o-mini"), // Automatic proxy support
    system: "You are a helpful assistant...",
  },
});
```

This migration significantly simplifies the provider system while adding powerful new features for configuration and environment handling.
