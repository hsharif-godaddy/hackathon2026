# AI SDK DevTools

AI SDK DevTools provides a web-based UI for debugging and inspecting LLM requests, responses, tool calls, and multi-step agent interactions.

> **⚠️ Security Warning**: DevTools stores all AI interactions locally in plain text files. **Only use in local development environments.** Do not enable in production.

## Quick Start

### 1. Enable DevTools

Add to your `.env` file:

```bash
ENABLE_AI_DEVTOOLS=true
```

Or simply run in development mode (`NODE_ENV=development`), where DevTools is enabled by default.

### 2. Start the DevTools Viewer

In a separate terminal:

```bash
cd agents
pnpm devtools
```

### 3. Open the UI

Navigate to http://localhost:4983 in your browser.

### 4. Run Your Agent

Start your agent server and make requests. All `generateText` and `streamText` calls will be captured and displayed in the DevTools UI.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLE_AI_DEVTOOLS` | Explicitly enable/disable DevTools | `undefined` |
| `NODE_ENV` | When set to `development`, DevTools is enabled by default | `undefined` |

### Enable/Disable Logic

DevTools is enabled when:
- `ENABLE_AI_DEVTOOLS=true`, OR
- `NODE_ENV=development` AND `ENABLE_AI_DEVTOOLS` is not `false`

```bash
# Explicitly enable
ENABLE_AI_DEVTOOLS=true

# Explicitly disable (even in development)
ENABLE_AI_DEVTOOLS=false

# Auto-enable in development
NODE_ENV=development
```

## What DevTools Captures

### Runs and Steps

- **Run**: A complete multi-step AI interaction, grouped by the initial prompt
- **Step**: A single LLM call within a run (e.g., one `generateText` or `streamText` call)

Multi-step interactions (tool calling, agent loops) are grouped as a single run with multiple steps.

### Captured Data

| Data Type | Description |
|-----------|-------------|
| **Input parameters** | Complete prompts and configuration sent to LLMs |
| **Output content** | Generated text and structured responses |
| **Tool calls** | Tool invocations with arguments and results |
| **Token usage** | Input/output token counts |
| **Timing** | Request duration and performance metrics |
| **Raw provider data** | Complete request/response payloads |

## Data Storage

DevTools stores captured interactions locally in:

```
agents/.devtools/generations.json
```

The `.devtools` directory is automatically added to `.gitignore` to prevent accidental commits of sensitive data.

## How It Works

The DevTools middleware wraps the language model using `wrapLanguageModel` from the AI SDK. It intercepts all `generateText` and `streamText` calls and stores the data locally.

```typescript
// Implementation in agents/src/utils/model-selection.ts
import { wrapLanguageModel } from 'ai'
import { devToolsMiddleware } from '@ai-sdk/devtools'

function wrapWithDevTools(model: LanguageModel): LanguageModel {
  if (!isDevToolsEnabled()) {
    return model
  }

  return wrapLanguageModel({
    model,
    middleware: devToolsMiddleware()
  })
}
```

## Troubleshooting

### DevTools Not Capturing Data

1. Verify `ENABLE_AI_DEVTOOLS=true` is set in your `.env`
2. Ensure the agent server is running
3. Check that requests are going through the wrapped model

### Viewer Not Loading

1. Ensure port 4983 is available
2. Try restarting with `pnpm devtools`
3. Check for errors in the terminal running the viewer

### Data Not Appearing in UI

1. Refresh the browser
2. Make a new request to generate fresh data
3. Check `.devtools/generations.json` exists and has content

## Reference

- [AI SDK DevTools Documentation](https://ai-sdk.dev/docs/ai-sdk-core/devtools)
- [AI SDK Core Documentation](https://ai-sdk.dev/docs/ai-sdk-core)

