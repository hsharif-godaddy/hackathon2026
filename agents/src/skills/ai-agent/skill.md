---
name: ai-agent
description: >-
  Add a custom AI chatbot or autonomous agent to your app using your own API key.
  Supports streaming chat, multi-turn conversations, and agents with tool use
  (API calls, database queries, real-time data lookups). Providers: OpenAI, Anthropic, Google.
whenToUse: >-
  User explicitly wants a CUSTOM AI-powered chatbot built with their own API key
  (OpenAI, Anthropic, or Google), or an autonomous agent that can call tools and APIs.
  NOT for general "add chat" or "add messaging" requests — those should use the
  inbox skill instead. Use this skill only for phrases like "custom AI chatbot",
  "build my own chatbot with OpenAI", "AI agent that calls APIs", "chatbot with tool use",
  "agent that can search my data", "AI that can answer questions about my app",
  "I want to use my own API key for chat". ALSO load for advice or comparison
  questions about which AI model or provider to use for a chatbot or agent (model
  selection, provider trade-offs, fast/cheap vs capable tiers), even when phrased
  as a question with no build verb.
dependencies:
  - ai
intents:
  - custom AI chatbot/AI agent with tools/build my own AI chatbot
  - AI model selection or provider comparison for a chatbot/agent
---

# AI Chatbot/Agent Skill

**Purpose:** Add a streaming AI chatbot or agentic assistant using the Vercel AI SDK. Supports OpenAI, Anthropic, and Google Gemini.

> Installs: Express streaming route (`POST /api/chat`), provider config (`src/lib/chatbot/chat-config.ts`), React UI (`src/pages/chatbot/ChatbotPage.tsx`). Client uses native `fetch` + `ReadableStream` — no extra React libraries needed.

---

## Step 1: Install Skill Templates

```typescript
skill({ action: 'install', skill: 'ai-agent' });
```

---

## Step 2: Ask the User — Provider, Model, and Mode

→ See `references/available-models.md` for the full model catalog and selection guide.

> "Which AI provider and model would you like to use?
>
> 1. **OpenAI** — e.g. `gpt-5-nano` (fast/cheap), `gpt-5-mini` (balanced), `gpt-5` (most capable)
> 2. **Anthropic** — e.g. `claude-haiku-4-5-20251001` (fast), `claude-sonnet-4-6` (balanced), `claude-opus-4-7` (most capable)
> 3. **Google** — e.g. `gemini-2.5-flash` (fast), `gemini-2.5-pro` (balanced), `gemini-3.1-pro-preview` (most capable)
>
> And what mode?
>
> - **Simple chatbot** — conversation only, no external tool calls
> - **Agent** — chatbot that can call tools (e.g. get current time, search data, call an API)"

Wait for the user's answer before proceeding. If the user is unsure which model
to pick, consult `references/available-models.md` and recommend based on their
use case (latency needs, complexity, budget). Copy model IDs verbatim from the
catalog — don't guess them.

---

## Step 3: Request the API Key

Run the matching `requestSecrets` call for the chosen provider, then install its package.

| Provider  | Secret name                    | Package             |
| --------- | ------------------------------ | ------------------- |
| OpenAI    | `OPENAI_API_KEY`               | `@ai-sdk/openai`    |
| Anthropic | `ANTHROPIC_API_KEY`            | `@ai-sdk/anthropic` |
| Google    | `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google`    |

Example for OpenAI (use the same shape for the other providers, swapping secret name and description):

```typescript
requestSecrets({
  title: 'OpenAI API Key',
  description: 'Your OpenAI API key to power the AI agent.',
  secrets: [
    { name: 'OPENAI_API_KEY', description: 'OpenAI API key (starts with sk-)', required: true },
  ],
  mode: 'add',
});
```

Then install the provider package (e.g. `npm install @ai-sdk/openai`).

---

## Step 4: Configure `chat-config.ts`

Open `src/lib/chatbot/chat-config.ts`. It contains three commented-out provider blocks (OpenAI, Anthropic, Google) — each follows the same pattern: read the secret with `getSecret()`, pass it directly to the `create*` factory, return the model instance.

Uncomment the block matching the user's provider, **delete the other two**, and update the model ID if the user specified one. Also delete the throwing placeholder at the bottom.

Example (OpenAI with `gpt-5-mini`):

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { getSecret } from '#airo/secrets';
import type { LanguageModel } from 'ai';

export function getChatModel(): LanguageModel {
  const apiKey = getSecret('OPENAI_API_KEY');
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('OPENAI_API_KEY is not set — add it via requestSecrets()');
  }
  return createOpenAI({ apiKey })('gpt-5-mini');
}
export const SYSTEM_PROMPT = 'You are a helpful assistant.';
```

The Anthropic and Google blocks use `createAnthropic({ apiKey })` and `createGoogleGenerativeAI({ apiKey })` respectively — same pattern, different factory and secret name (see the file).

Also update `SYSTEM_PROMPT` to match the app's purpose and ask the user if they want a specific persona (e.g. "You are a customer support agent for Acme Corp.").

---

## Step 5: Enable Agent Mode (if chosen)

Open `src/server/api/chat/POST.ts` and:

1. Uncomment the agent mode imports at the top (`tool` from `ai`, `z` from `zod`).
2. Uncomment the `tools` and `maxSteps` block inside `streamText(...)`.

Both sections are already in the file with clear comments — no extra code to write. Then ask the user what tools they need and implement them inside the `tools` block. The file includes a `getCurrentTime` tool as a working example to follow.

---

## Step 6: Add the Chatbot Route

Open `src/routes.tsx` and add three things:

1. Lazy import (with the other lazy imports):

```typescript
const ChatbotPage = lazy(() => import('./pages/chatbot/ChatbotPage'));
```

2. Route entry (before any catch-all `*` route):

```typescript
{ path: '/chat', element: <ChatbotPage /> },
```

3. Update the `Path` type at the bottom to include `'/chat'`.

---

## After Setup: Ask User

> "Your chatbot is live at `/chat`! Would you like to:
>
> 1. **Add a navigation link** to the chat page?
> 2. **Customize the system prompt** to give the assistant a specific role?
> 3. **Add specific tools** for agent mode (search database, call an API, check inventory)?
> 4. **Style the UI** (colors, welcome message, avatar, layout)?"

---

## Known Behaviors & Edge Cases

| Situation                      | What to do                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| API key not set                | `getChatModel()` throws on first request — always run `requestSecrets` before configuring      |
| Streaming fails in nginx proxy | `POST.ts` sets `X-Accel-Buffering: no` — verify that line is present                           |
| Agent loops without stopping   | Reduce `maxSteps` in `streamText()` — agent mode should use 3–10                               |
| Tool TypeScript errors         | Import `tool` from `ai` and `z` from `zod`; use `z.object({})` for tools with no parameters    |
| User wants to change model     | Edit the model string in `getChatModel()` — e.g. `createOpenAI({ apiKey })('gpt-4o')`          |
| Want to protect the chat route | Wrap with `ProtectedRoute` from auth skill: `<ProtectedRoute><ChatbotPage /></ProtectedRoute>` |
| Rate limiting / cost control   | Add `maxTokens` to `streamText()` to cap response length                                       |
