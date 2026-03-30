# Agents Service

Express API (port 4000) providing AI agent orchestration, app lifecycle, WebSocket streaming, and SQLite persistence.

## Security — Tenant Isolation

**All routes accepting appId or conversationId MUST validate ownership.** Every request has `req.agentContext.siteId` from the JWT. Resources must belong to that site.

**Use middleware from `src/server/middleware/app-ownership.ts`:**

| Middleware                      | Use when appId is in... |
| ------------------------------- | ----------------------- |
| `validateAppOwnership`          | Route params (`:id`)    |
| `validateAppOwnershipFromBody`  | Request body            |
| `validateAppOwnershipFromQuery` | Query parameters        |
| `validateConversationOwnership` | Conversation routes     |

**Critical:** Middleware must be placed BEFORE the routes it protects. Express middleware only applies to routes defined after it — defining routes first and middleware later leaves them unprotected.

**Regex pattern for apps routes** prevents matching static routes like `/create`:

```typescript
router.use(
  '/:id([a-z0-9]{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
  validateAppOwnership
);
```

**BYPASS_SITE_IDS** (`src/services/features.ts`): `bypass-site`, `default-site`, `local-dev-site`, `mock-site-id`, `unknown-site` — skip isolation for local dev/testing. Never in production.

**WebSocket security** (`src/server/ai-lib-websocket-server.ts`): Three layers — connection JWT validation, per-message appId validation, conversation ownership verification.

## Agent System

### Agent Selection Flow

When a user sends a message (`ai-lib-websocket-server.ts` → `experimental-websocket-server.ts`):

1. **Manual override** — message starts with `/agent <name>`
2. **Session state** — existing active agent for this socket/app
3. **App context** — no conversations yet → `InitialAgent`, otherwise → `DevelopAgent`
4. **Client-specified** — `data.agentId` or `data.agentName`
5. **Default** → `DevelopAgent`

### Agents

| Agent              | Purpose                           | Handoff targets                  |
| ------------------ | --------------------------------- | -------------------------------- |
| **InitialAgent**   | First-time app scaffolding        | —                                |
| **DevelopAgent**   | Feature development, code changes | marketing, commerce (if enabled) |
| **MarketingAgent** | SEO/marketing content             | —                                |
| **CommerceAgent**  | E-commerce (feature-flagged)      | —                                |
| **DesignAgent**    | UI/UX design                      | —                                |

Implementations: `src/agents/`. Factory: `src/agents/ai-lib-agents/index.ts`.

### Prompt Composition

Prompts are built from composable markdown fragments via `createPromptBuilder()`:

```
src/prompts/
├── develop/          # DevelopAgent fragments (core.md, font-theme.md, handoff.md, etc.)
├── shared/           # Reusable across agents (communication.md, filesystem.md, security.md)
└── template-descriptions/  # Per-template context (v8.md, etc.)
```

Dynamic content injected at runtime: skills list, commerce rules (feature-flagged), visual context (page, scroll position, viewport) from client.

Base class: `src/base/base-agent.ts` — `getSystemPrompt()` → `loadSystemPromptFromFile()` → `composePrompt()`.

### Tool System

~50 tools registered in `src/tools/ai-lib-tools/index.ts` (`allAILibTools`). Each agent declares which tools it uses in its config.

**Stop-after tools:** `handoff`, `suggestedResponse`, `media__generate_logo` — agent pauses for user confirmation.

**Skills system:** Dynamic tool loading via `skillToolManager`. Skills activated/deactivated per conversation. Tool names prefixed `skill__{skillName}`.

### GitUtils Requirement

**All git operations in git-tool.ts MUST use `GitUtils` methods** (`src/utils/git.ts`). This ensures consistent error recovery via `attemptGitRecovery()` and proper logging. If a git operation isn't available in GitUtils, add a new method there.

Key methods: `addFiles`, `removeFiles`, `writeTree`, `commitTree`, `reset`, `push`, `commit`, `getStatus`.

## ai-lib & Shared Types

`packages/ai-lib/` is consumed by agents. It wraps Vercel AI SDK and provides:

- **AgentFactory** — multi-agent lifecycle, tool calling loops, streaming
- **WebSocket server** — `experimental-websocket-server.ts` (base class extended by agents service)
- **Provider abstraction** — OpenAI, Anthropic, Google (Bedrock removed as of 2026-03-30)
- **Message building** — history normalization, cache points

**Integration via callbacks** (not hard coupling): `agentRouter`, `contextProvider`, `messageProvider`, `messagePersistence`. The agents service provides domain-specific implementations.

Key integration file: `src/server/ai-lib-websocket-server.ts` (extends ai-lib's base WS server).

**Shared domain types** (grants, context-attachment, social, websocket) live in `@airo/shared`. Agents-specific extensions (type guards, Zod schemas, rendering infrastructure) stay local in `src/types/`.

## Database

**SQLite** at `agents/data/agents.db`. Required because production deploys one agent per app — no shared DB.

| Table                   | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `apps`                  | Application records (AAB only, may not exist for PaaS) |
| `conversations`         | Chat conversations per app                             |
| `conversation_messages` | Message history                                        |
| `git_remote_config`     | Git repository config (AAB)                            |
| `oauth_tokens`          | OAuth tokens                                           |
| `token_usage`           | LLM token tracking                                     |
| `file_context`          | RAG file context                                       |

Repositories: `src/database/repositories/`.

## Observability

Agent interactions instrumented via OpenTelemetry + Langfuse.

**Context layering** (each level enriches spans):

```
createTraceContext({ headers })       → Signals metadata (visitor, customer, session)
  → createAgentContext(...)           → Agent metadata (conversationId, agentId)
    → createAgentInvocationSpan()     → GenAI invocation span
      → AI SDK streamGenerate()       → Vercel AI spans inherit context
```

**Explicit events:** `emitConversationStart`, `emitHandoff`, `emitError` — span processor handles LLM/tool events automatically.

**SDKs:** `@signals/otel-sdk`, `@godaddy/agent-otel-sdk`, `@godaddy/agent-observability-events`

**Config:** `ENABLE_OBSERVABILITY_EVENTS=true`, env derived from `GODADDY_API_BASE_URL` via `resolveEnv()` in `src/utils/gd-env.ts`.

Key files: `src/server/instrumentation.ts`, `src/server/conversation-persistence.ts`, `packages/ai-lib/.../experimental-websocket-server.ts`.

## Memory Debugging

- `/health` — public, basic metrics
- `/diagnostics/memory` — authenticated (JOMAX token), V8 heap details
- Periodic logging every 5 min (`MEMORY_LOG_INTERVAL_MS`): search for `memory.periodic.snapshot`
- Dev memory limit: `--max-old-space-size=384` (matches production 512MB - overhead)

## Local Dev Logs

When running locally (`GASKET_ENV=local.*`), all stdout/stderr is automatically written to `agents/dev.log` (ANSI codes stripped). The file is truncated on each restart. Use this log to troubleshoot issues — read it to see recent errors, startup failures, or unexpected behavior.

## Testing

```bash
pnpm --filter @airo/agents test:unit
pnpm --filter @airo/agents test:unit "pattern"       # File filter
pnpm --filter @airo/agents test:unit -t "test name"   # Test name filter
pnpm --filter @airo/agents test:integration
```

Authorization tests: `src/server/middleware/__tests__/app-ownership.test.ts`, `src/server/routes/__tests__/authorization-security.integration.test.ts`.

Note: Unit tests exclude `*.integration.test.ts` files (which need real services). Integration tests run separately via `test:integration`.
