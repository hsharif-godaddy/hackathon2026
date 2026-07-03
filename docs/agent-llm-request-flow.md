# Agent-to-LLM Request Flow

How a user message flows through the system end to end — from typing in the builder UI to code changes on disk.

## 1. Browser → WebSocket (Socket.IO)

The Next.js app (`app/`, port 3000) has a chat UI that opens a **Socket.IO** connection to the agents service (port 4000). Your message is sent as a WebSocket event, along with metadata like `appId`, `conversationId`, screenshots of the current page, and visual context.

## 2. JWT Auth + Agent Routing

`agents/src/server/ai-lib-websocket-server.ts` handles the connection. On each message:

- **JWT validated** via `jwtAuthMiddleware`
- **Agent selected** by the `agentRouter` callback (~line 1146):
  1. Session already has an active agent for this socket?
  2. No conversations yet for this app? → `InitialAgent` (scaffolding)
  3. Otherwise → **`DevelopAgent`** (the most common path)

## 3. Context Assembly

Before calling the LLM, the system assembles a rich context:

- **System prompt** — `agents/src/agents/develop-agent.ts:buildDevelopSystemPrompt()` uses `createPromptBuilder()` to compose ~10K+ tokens of markdown fragments from `agents/src/prompts/develop/` (core.md, handoff.md, backend.md, etc.) plus shared fragments from `agents/src/prompts/shared/`
- **Conversation history** — loaded from SQLite via `messageProvider.loadMessages()`, token-limited to ~40K tokens
- **Visual context** — screenshots, scroll position, viewport info sent by the browser client
- **App context** — template description, file tree, page structure injected via `AILibContextManager`
- **RAG docs** — documentation retrieved via KnowB (GoKnowb) semantic search (`searchDocumentation`)

## 4. Agent → LLM Call

The transport layer (`packages/ai-transport/src/experimental-websocket-server.ts`, ~line 3309) calls:

```typescript
agent.streamGenerate(userMessage, {
  context: contextMessages,
  messages: conversationHistory,
  executionContext: { appId, customerId, ... },
  files: screenshots,
})
```

This hits `AgentWrapper.streamGenerate()` in `packages/ai-lib/src/core/agent-factory.ts` (~line 844), which:

1. Checks for model overrides (env var or per-request)
2. Handles grant/budget checking (billing)
3. Calls `this.agent.stream()` — where `this.agent` is a **Vercel AI SDK `ToolLoopAgent`** (~line 295)

## 5. Provider + Model

`packages/ai-lib/src/providers/unified-provider.ts` resolves which LLM to call:

- Default model: **Claude Sonnet** (via `getAgentModelWithName('full')`)
- Routes through an **OpenAI-compatible proxy** (GoCode) or **direct Anthropic API** depending on config
- Uses `@ai-sdk/openai-compatible` or `@ai-sdk/anthropic` SDK adapters

## 6. Tool Loop (The Agentic Part)

The `ToolLoopAgent` from Vercel AI SDK runs in a loop:

```
User message → LLM → [tool call?] → execute tool → feed result back → LLM → ... → final text
```

The DevelopAgent has ~20+ tools registered (`agents/src/agents/develop-agent.ts`, ~line 219):

| Tool                          | What it does                                    |
| ----------------------------- | ----------------------------------------------- |
| `str_replace_based_edit_tool` | Edit files (the main code-writing tool)         |
| `readFile`                    | Read project files                              |
| `terminalCommand`             | Run shell commands                              |
| `serverRestart`               | Restart the dev server                          |
| `directoryListing`            | Browse project structure                        |
| `grepSearch`                  | Search code                                     |
| `colorScheme` / `fontTheme`   | Design tools                                    |
| `publishClient`               | Trigger publish                                 |
| `skill`                       | Load dynamic skill tools (commerce, auth, etc.) |

For example, "change the homepage background to blue" would likely produce:

1. `readFile` — read the current homepage file
2. `str_replace_based_edit_tool` — modify the CSS/style
3. `serverRestart` — refresh the preview
4. Final text response explaining what was done

Each tool call goes through `beforeToolExecution` / `afterToolExecution` hooks for logging. Max 100 steps per turn (`maxSteps: 100`).

## 7. Response Streaming

The LLM response streams back through:

```
LLM → AI SDK stream → AgentWrapper → WebSocket transport → Socket.IO → Browser UI
```

Text chunks arrive in real-time. Tool calls are also streamed as events so the UI can show progress indicators.

## 8. Persistence

After completion, `AgentsMessagePersistence` (`agents/src/server/conversation-persistence.ts`) saves both the user message and assistant response (including tool calls/results) to SQLite for conversation history.

## Visual Summary

```
Browser (Next.js app:3000)
  |  Socket.IO message + screenshots + metadata
  v
WebSocket Server (agents:4000)  --- ai-lib-websocket-server.ts
  |  JWT auth -> agent routing -> context assembly
  v
AgentWrapper.streamGenerate()   --- packages/ai-lib/core/agent-factory.ts
  |  budget check -> model override
  v
ToolLoopAgent (Vercel AI SDK)
  |  prompt + tools + history
  v
Unified Provider               --- packages/ai-lib/providers/unified-provider.ts
  |  OpenAI proxy or Anthropic direct
  v
Claude LLM (Sonnet/Opus)
  |  response with tool calls
  v
Tool execution loop (readFile -> edit -> restart -> ...)
  |  results fed back to LLM
  v
Final text response streamed back to browser
```

## Key Files

| File                                                         | Role                                   |
| ------------------------------------------------------------ | -------------------------------------- |
| `agents/src/server/ai-lib-websocket-server.ts`               | Entry point, routing, context          |
| `agents/src/agents/develop-agent.ts`                         | Agent config, tools, system prompt     |
| `agents/src/agents/ai-lib-agents/index.ts`                   | Agent factory creation                 |
| `packages/ai-lib/src/core/agent-factory.ts`                  | `AgentWrapper` + `ToolLoopAgent`       |
| `packages/ai-transport/src/experimental-websocket-server.ts` | WebSocket transport, stream management |
| `packages/ai-lib/src/providers/unified-provider.ts`          | LLM provider routing                   |
| `agents/src/tools/ai-lib-tools/index.ts`                     | All 44 tool definitions                |
| `agents/src/prompts/develop/`                                | System prompt fragments                |
| `agents/src/server/conversation-persistence.ts`              | Message persistence to SQLite          |
| `agents/src/agents/ai-lib-agents/context-manager.ts`         | Runtime context injection              |
