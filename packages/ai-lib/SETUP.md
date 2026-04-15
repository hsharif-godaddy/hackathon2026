# 🚀 Quick Setup Guide

Get started with the AI Library in 3 easy steps!

## Step 1: Install Dependencies

```bash
# Install the library (OpenAI support included!)
npm install @airo/ai-lib

# For other providers, install as needed:
npm install @ai-sdk/anthropic     # For Anthropic/Claude models
```

## Step 2: Configure Environment

```bash
# Copy the example environment file
cp env.example .env

# Edit .env and add your API keys
```

### Environment Variables

**For OpenAI:**
```env
DEFAULT_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
DEFAULT_MODEL=gpt-4o-mini
```

**For Anthropic:**
```env
DEFAULT_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key_here
DEFAULT_MODEL=claude-sonnet-4-6
```

## Step 3: Run Examples

```bash
# Test basic functionality (no API calls)
npm run example:basic

# Run full example with AI generation
npm run example:setup

# Check setup status
npm run setup
```

## Quick Start Code

```typescript
import { createAgentFactory, getModel, tools } from '@airo/ai-lib'

// Create agents (OpenAI support built-in!)
const agentFactory = createAgentFactory()
const agents = agentFactory.defineAgents({
  assistant: {
    name: 'Assistant',
    systemPrompt: 'You are a helpful AI assistant.',
    model: await getModel('gpt4o-mini'), // Auto-configured from .env
    tools: [tools.webSearch()]
  }
})

// Use anywhere
const assistant = agents.get('assistant')
const response = await assistant.generate('Hello!')
console.log(response.content)
```

## Troubleshooting

### "Cannot resolve module" Error
For non-OpenAI providers, install the required package:
```bash
npm install @ai-sdk/anthropic     # For Claude models
```
(OpenAI is already included!)

### "API key" Error
1. Check your `.env` file exists
2. Verify the API key is correct
3. Make sure you're using the right environment variable name

### Environment Not Loading
The library automatically loads `.env` from the package root. If you're running from a different directory, make sure the `.env` file is in the right location.

## Need Help?

- Check the `examples/` directory for more detailed examples
- Read the main `README.md` for full API documentation
- Look at `env.example` for all available configuration options
