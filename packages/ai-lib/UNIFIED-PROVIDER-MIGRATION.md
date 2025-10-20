# Unified Provider Migration

This document describes the migration from the old provider system to the new unified provider helper.

## 🔄 **What Changed**

### **Removed Files**

- ❌ `src/providers/openai.ts` - Old OpenAI provider helpers
- ❌ `src/providers/bedrock.ts` - Old Bedrock provider helpers
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

// Bedrock models
const claude4 = await getModel("claude4");
const haiku = await getModel("haiku");
const sonnet = await getModel("sonnet");
```

### **2. Short, Memorable Model Names**

```typescript
// Instead of: 'global.anthropic.claude-sonnet-4-20250514-v1:0'
const claude = await getModel("claude4");

// Instead of: 'gpt-4o-mini'
const gpt = await getModel("gpt4o-mini");
```

### **3. Automatic Environment Validation**

```typescript
// Validates environment before model creation
try {
  const model = await getModel("claude4");
} catch (error) {
  // Clear error messages about missing AWS credentials
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

### **5. Flexible AWS Credential Handling**

```typescript
// Uses AWS credential provider chain (profiles, IAM roles, etc.)
const model = await getModel("claude4");

// Or explicit credentials
const model = await getModel("claude4", {
  awsAccessKeyId: "...",
  awsSecretAccessKey: "...",
  awsRegion: "us-west-2",
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

### **Bedrock Claude Models**

| Short Name        | Full Name                                        | Provider |
| ----------------- | ------------------------------------------------ | -------- |
| `claude4`         | `global.anthropic.claude-sonnet-4-20250514-v1:0` | bedrock  |
| `sonnet4`         | `global.anthropic.claude-sonnet-4-20250514-v1:0` | bedrock  |
| `sonnet`          | `anthropic.claude-3-5-sonnet-20241022-v2:0`      | bedrock  |
| `haiku`           | `anthropic.claude-3-haiku-20240307-v1:0`         | bedrock  |
| `claude35-sonnet` | `anthropic.claude-3-5-sonnet-20241022-v2:0`      | bedrock  |
| `claude3-sonnet`  | `anthropic.claude-3-sonnet-20240229-v1:0`        | bedrock  |
| `claude3-haiku`   | `anthropic.claude-3-haiku-20240307-v1:0`         | bedrock  |

## 🔧 **Migration Guide**

### **Before (Old Provider System)**

```typescript
import { bedrockModels } from "@airo/ai-lib";
import { createOpenAI } from "@ai-sdk/openai";

// Complex setup for different providers
const claude = await bedrockModels.claudeSonnet4();
const openaiProvider = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
});
const gpt = openaiProvider("gpt-4o");
```

### **After (Unified Provider)**

```typescript
import { getModel } from "@airo/ai-lib";

// Simple, consistent interface
const claude = await getModel("claude4");
const gpt = await getModel("gpt4o"); // Automatic proxy support
```

### **Updated Examples**

All examples have been updated to use the unified provider:

- ✅ `basic-openai.ts` - Uses `getModel('gpt4o-mini')` etc.
- ✅ `basic-bedrock.ts` - Uses `getModel('claude4')` etc.
- ✅ `agentic-bedrock-simple.ts` - Uses `getModel('claude4')`
- ✅ `agentic-bedrock-full.ts` - Uses `getModel('claude4')`
- ✅ `agentic-bedrock-prompt-caching.ts` - Uses `getModel('claude4')`
- ✅ `agentic-bedrock-file-upload.ts` - Uses `getModel('claude4')`

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
// ['gpt4o', 'gpt4o-mini', 'claude4', 'haiku', ...]

// Check if a model is supported
const isSupported = isModelSupported("claude4"); // true

// Get full model identifier from short name
const fullName = getFullModelName("claude4");
// 'global.anthropic.claude-sonnet-4-20250514-v1:0'

// Validate environment for a model
const isValid = validateModelEnvironment("gpt4o"); // true/false

// Get detailed model information
const info = getModelInfo("claude4");
// { shortName: 'claude4', fullName: '...', provider: 'bedrock', isSupported: true }
```

## ✅ **Benefits**

1. **Simplified API** - One function for all providers
2. **Better UX** - Short, memorable model names
3. **Automatic Validation** - Environment checks before model creation
4. **Built-in Proxy Support** - OpenAI proxy detection and configuration
5. **Flexible Credentials** - Multiple AWS credential options
6. **Type Safety** - Full TypeScript support
7. **Consistent Interface** - Same API regardless of provider
8. **Error Handling** - Clear error messages for configuration issues

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

  bedrockAgent: {
    name: "Claude Assistant",
    model: await getModel("claude4"), // Automatic AWS credentials
    system: "You are Claude...",
  },
});
```

This migration significantly simplifies the provider system while adding powerful new features for configuration and environment handling.
