# Agents Rules and Guidance

**Read this before writing, editing, or executing anything in this repo.**

## Project Overview

Airo Builder: AI-powered app development platform with multi-service architecture, AI agents, real-time collaboration, and flexible deployment.

## General Rules

<critical_file_safety>
Files under `/tmp/apps/{appId}/app/**` are generated OUTPUT. Fix generation logic in source, not output files.
</critical_file_safety>

<code_quality_standards>

- Be direct and concise, challenge solutions when you have better alternatives
- Validate props/imports/paths exist before use - read files, don't assume
- Ask clarifying questions when ambiguous
- Read and understand code before proposing changes - never speculate
  </code_quality_standards>

<design_system_requirements>
In `/app` folder ONLY:

- Use UXCore design system (@ux/\*) - see `/app/uxcore-llm.txt` and `/app/design-guidance.md`
- NO default Tailwind colors (`bg-white`, `text-blue-600`)
- Prioritize accessibility and usability
  </design_system_requirements>

## Key Commands

**Setup:**

```bash
./setup.sh                          # Automated setup
pnpm --filter airo-setup start      # Selective config
pnpm install && pnpm run dev        # Manual: agents:4000, app:3000
```

**Development:**

```bash
pnpm typecheck / lint / test / test:e2e / build / build:all
pnpm --filter @airo/agents test:unit / test:integration
pnpm --filter <package> build
```

**Ports:** Agents=4000, App=3000. Kill conflicting processes.

## Architecture

**pnpm workspace monorepo** - Always use `pnpm`, never `npm`

### Core Services

| Service                        | Package                  | Port | Description                                                         |
| ------------------------------ | ------------------------ | ---- | ------------------------------------------------------------------- |
| **agents/**                    | `@airo/agents`           | 4000 | Express API, agent registry, app lifecycle, SQLite, WebSocket       |
| **app/**                       | `website`                | 3000 | Next.js builder UI, Monaco, chat, MySQL/Prisma, GoDaddy SSO, UXCore |
| **website/**                   | N/A                      | N/A  | Marketing site                                                      |
| **app-templates/**             | N/A                      | N/A  | v8 (Vite+React+Node), copied for new apps                           |
| **packages/ai-lib/**           | `@airo/ai-lib`           | N/A  | Shared AI utilities (build before agents)                           |
| **packages/design-extractor/** | `@airo/design-extractor` | N/A  | PDF design extraction for RAG                                       |
| **setup/**                     | `airo-setup`             | N/A  | Interactive config utility                                          |
| **e2e/**                       | `airo-app-builder-e2e`   | N/A  | E2E tests (Cypress/Testla)                                          |

### Key Patterns

**Deployment:** Docker Compose (dev/local), enterprise adapter (prod) via adapter pattern for environment abstraction. Key: `app/src/lib/dev-environment/adapters/DockerAppService.ts`

**Container Orchestration:**

- `docker-compose-generator.ts` - Creates compose files per app
- `docker-compose-manager.ts` - Lifecycle, logs, health
- `docker-container-manager.ts` - Operations, recovery, cleanup
- Generated: `/tmp/apps/{appId}/docker-compose.yml`

**HTTP Proxy (dev-supervisor):**

- **Ports**: 5000+ (HTTPS), 8877+ (API)
- **TLS termination**, reverse proxy :8080, WebSocket, retry backoff
- **Static Serving**: Auto-serves static files from `dist/client/` in production mode (configurable)
- **SPA Fallback**: For GET requests to extensionless paths, tries serving real file first (e.g., `/.well-known/apple-app-site-association`), then falls back to `index.html`. HEAD/OPTIONS on non-existent extensionless paths return 404 when SPA mode is on; otherwise they proxy to backend (for health checks, CORS preflight).
- **Modes**:
  - **Dev mode** (SERVE_STATIC=false): Forwards all non-API to backend Vite (maintains HMR)
  - **Production mode** (SERVE_STATIC=true): Serves static files directly with cache headers
- **Config**:
  - Basic: `DEV_SUPERVISOR_ENABLE_PROXY`, `*_PROXY_PORT`, `*_TARGET_HOST/PORT`, `*_CERT/KEY_PATH`
  - Static: `DEV_SUPERVISOR_SERVE_STATIC=false` (default), `*_STATIC_ROOT` (default: `/app/dist/client`), `*_SPA_MODE=true`, `*_API_PREFIX=/api`
  - Advanced: `*_ROUTING_CONFIG=/path/to/config.json` (optional JSON config for cache settings; forward_rules not yet implemented)
  - Retry: `*_MAX_RETRIES=10`, `*_INITIAL_BACKOFF_MS=200`, `*_MAX_BACKOFF_MS=5000`
- **Cache Headers**: 1 year for content-hashed assets (.js/.css), 30 days for images, no-cache for index.html
- **HTTP Methods**: Supports GET, HEAD, OPTIONS for static assets (browser cache validation)
- **Errors**: 503 (backend starting, retries with backoff: ~31s dev/~4s prod), 502 (proxy error)
- **Files**: `dev-supervisor/{http_proxy,main,api}.go`

**App Structure:**

```
/tmp/apps/{appId}/
  ├── app/              # Code
  ├── alloc/            # Config (config.json)
  └── docker-compose.yml
```

Docker bind mounts: `{basePath}/app:/app`, `{basePath}/alloc:/alloc`

**Dependencies:** Build `packages/ai-lib` before `agents`, install `app-templates/v8` deps, use `pnpm --filter <pkg>`

### AI Agent System

- Base: `agents/src/base/base-agent.ts`
- Registry: `agents/src/registry/agent-registry.ts`
- Factory: `agents/src/agents/ai-lib-agents/index.ts`
- Agents: InitialAgent, DevelopAgent, ColorSchemeAgent, MarketingAgent, CommerceAgent (opt-in), ExampleAgent
- Prompts: `agents/src/prompts/`

**Feature Flags (`agents/src/services/features.ts`):**

- `ENABLE_COMMERCE_AGENT=true` - GoDaddy Commerce (dev/test only)
- `ENABLE_SOCIAL_PLATFORM=true` - Social tools in MarketingAgent (dev/test only)
- Check: `agents.isEnabled("commerce")` / `agents.isEnabled("social")`

### Database

**App (MySQL/Prisma):** Docker Compose container, `app/.env`: `DATABASE_URL`, schema: `app/prisma/`, package: `website`

```bash
pnpm --filter website exec prisma migrate dev / generate / studio
```

### Tools

In `agents/src/tools/`:

- File: `file-edit`, `read-file`, `directory-listing`
- Dev: `git-tool`, `terminal`, `grep-tool`
- Code: `ast-style-editor`, `ast-text-editor`, `ast-editor-base`
- Media: `media-search-tool` (image/video search, AI generation via Getty/DALL-E)
- Infra: `server-management-tool`, `mysql-tool`, `secrets-management-tool`, `view-logs-tool`
- AI: `memory-tool`, `rag-tool`, `skill-loader-tool`
- Specialized: `commerce-product-tool`, `website-scraper-tool`, `app-plan-tool`, `css-color-tool`, `todo-list-tool`, `icons-validator`

### Screenshot Capture

Flow: Conversation end → preview → screenshot → postMessage → upload → `{appId}-screenshot.png`

- API: `GET/POST /api/apps/:id/screenshot`
- Config: `SCREENSHOT_DIR` (default: `/tmp/apps/{appId}/`), 512px PNG

## Environment Config

**agents/.env:**

```bash
OPENAI_API_KEY=key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4
APP_TEMPLATE_DIR=app-templates/v8
SHOW_USAGE_COST=true

MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=

GETTY_API_URL=<url>
GETTY_TOKEN=<token>
IMAGE_SEARCH_DRIVER=getty

LOG_LEVEL=debug
LOG_FORMAT=dev
LOG_DOMAINS=app,agent,websocket
LOG_DISABLED_DOMAINS=compression,memory
LOG_OPT_IN_DOMAINS=compression.hot_files

SCREENSHOT_DIR=/tmp/screenshots
ENABLE_COMMERCE_AGENT=true
ENABLE_SOCIAL_PLATFORM=false
```

**app/.env:**

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://airo:airopassword@localhost:3306/airo_app?sslaccept=accept_invalid_certs
NEXT_PUBLIC_USE_MOCK_LOGIN=true
```

Use `./setup.sh` or `pnpm --filter airo-setup start` instead of manual creation.

## Important Patterns

**App Lifecycle:** `creating` → `created` → `running`/`stopped`/`error`. Async setup, auto recovery, cleanup. DO NOT edit `/tmp/apps/{appId}/app/`.

### WebSocket Architecture

**Overview:** Socket.IO V2-based real-time communication with XState v5 state machine managing all lifecycle state.

**Core Components:**

1. **XState Machine** (`app/src/services/websocket/webSocketMachine.ts`)
   - Single source of truth for connection + streaming lifecycle
   - Parallel regions: `transport` (connection) + `stream` (messaging)
   - Guards, actions, delays for retry/recovery logic
   - 20 comprehensive tests

2. **StoreSyncAdapter** (`app/src/services/websocket/StoreSyncAdapter.ts`)
   - Declarative mapping: machine state → Zustand store updates
   - Subscribes to machine transitions, syncs to store
   - **Only** place that calls lifecycle store actions
   - 13 comprehensive tests

3. **StreamingWebSocketController** (`app/src/services/websocket/StreamingWebSocketController.ts`)
   - Integrates machine, adapter, ConnectionManager, message handlers
   - Sends machine events on lifecycle changes (CONNECT, DISCONNECT, STREAM_ERROR, etc.)
   - Passes machine actor to handlers via MessageContext

4. **Message Handlers** (`app/src/hooks/websocket/handlers/`)
   - Process server messages (chunks, tool deltas, errors, recovery, etc.)
   - Can send lifecycle events to machine (optional machine actor in context)
   - Registry pattern for extensibility

**Architecture Principles:**

**Tier 1 (Lifecycle State)** - Machine → Adapter → Store

- Connection states: disconnected, connecting, connected, reconnecting
- Streaming states: idle, streaming, completed, error
- Recovery/retry states
- **Rule:** Handlers NEVER call lifecycle methods directly (setWebSocketState, setStreamingState, setIsLoading)

**Tier 2 (Transcript Data)** - Handlers → Store directly

- Message content: appendTextSegment, addToolCallSegment, etc.
- Stream finalization: finalizeStream (with metadata)
- Performance-critical operations bypass machine for efficiency

**Data Flow:**

```
User Action → Controller Event → Machine Transition → Adapter Sync → Store Update → UI
```

**Type Safety:**

```typescript
import { type WebSocketActor } from "@/services/websocket/webSocketMachine";

// In handlers, machine is required and properly typed:
interface MessageContext {
  machine: WebSocketActor; // Required, not optional
}

// Send events with full type checking:
context.machine.send({ type: "STREAM_ERROR", error, retryable: false });
```

**Testing Patterns:**

1. **Machine Tests** - Test state transitions in isolation

   ```typescript
   import { StateMachineTestHarness } from "./StateMachineTestUtils";
   const harness = new StateMachineTestHarness();
   harness.machine.simulateConnect("app-123");
   harness.machine.assertState((s) => s.matches({ transport: "connected" }));
   ```

2. **Adapter Tests** - Test machine → store mappings

   ```typescript
   import { StoreSyncAdapterTestHarness } from "./StoreSyncAdapterTestUtils";
   const harness = new StoreSyncAdapterTestHarness();
   harness.assertStoreActionCalled("setWebSocketState");
   ```

3. **Handler Tests** - DO NOT assert lifecycle method calls

   ```typescript
   // ❌ WRONG - handlers don't call these anymore
   expect(context.actions.setStreamingState).toHaveBeenCalled();

   // ✅ CORRECT - assert data operations (Tier 2)
   expect(context.actions.finalizeStream).toHaveBeenCalled();
   expect(context.actions.appendTextSegment).toHaveBeenCalledWith("text");
   ```

**Common Patterns:**

- **Adding lifecycle event:** Update `MachineEvent` type in `stateMachineTypes.ts`, add handler for event in machine
- **Adding store action:** Tier 1 → add to adapter; Tier 2 → call directly from handler
- **Cleanup:** Always call `controller.destroy()` in cleanup (stops actor, unsubscribes adapter)
- **Observability:** Machine logs all transitions via structured logging (`logger.info('websocket.machine.*')`)

**Key Files:**

- Machine: `app/src/services/websocket/webSocketMachine.ts` (420 LOC)
- Adapter: `app/src/services/websocket/StoreSyncAdapter.ts` (232 LOC)
- Controller: `app/src/services/websocket/StreamingWebSocketController.ts`
- Types: `app/src/services/websocket/stateMachineTypes.ts`
- Tests: `app/src/services/websocket/__tests__/`
- Handlers: `app/src/hooks/websocket/handlers/`

**Documentation:** See `WEBSOCKET_REFACTOR_SUMMARY.md` for complete implementation details.

**Integrations:** OpenAI/Bedrock/GoCode, Git, Docker Compose, Socket.IO, SQLite (agents), MySQL/Prisma (app), Getty, GoDaddy SSO

## Working with Claude 4.5

<default_to_action>
Implement changes by default, not suggestions. When asked for improvements, make them directly. If unclear, infer best action and proceed. Only suggest when explicitly asked.
</default_to_action>

<use_parallel_tool_calls>
Call independent tools in parallel for efficiency (read files, run commands, search). Execute sequentially only when dependent. Never use placeholders.
</use_parallel_tool_calls>

<avoid_overengineering>
Minimum complexity for current task only:

- No features, refactors, or "improvements" beyond what's asked
- No error handling for impossible scenarios - trust framework guarantees
- Validate only at system boundaries (user input, external APIs)
- No helpers/abstractions for one-time operations
- No hypothetical future requirements
- Reuse existing abstractions, follow DRY
  </avoid_overengineering>

<context_awareness>
Context auto-compacts at limits. Complete tasks fully regardless of budget. Save progress to memory before refresh. Never stop early.
</context_awareness>

## Logging Standards

<structured_logging_requirements>
Use `logger.info/warn/error("event.name", { data })` with typed interfaces and hierarchical names (`domain.operation.lifecycle`). No emojis. Enables production monitoring, filtering, aggregation.
</structured_logging_requirements>

**Examples:**

```typescript
logger.info("app.create.begin", {
  appId,
  name,
  templateVersion,
  baseDir,
  port,
});
logger.error("conversation.load.failure", {
  appId,
  conversationId,
  error: getErrorMessage(error),
});
```

**Categories:** `src/logging/events/index.js` - appCreationEvents, appServerEvents, appDockerEvents, conversationHistoryEvents, webSocketConnectionEvents, toolGitEvents, toolFileEditEvents, llmEvents

**Control:**

```bash
LOG_LEVEL=debug|info|warn|error|fatal
LOG_DOMAINS=app,websocket               # Allowlist
LOG_DISABLED_DOMAINS=compression,memory # Blocklist
LOG_OPT_IN_DOMAINS=compression.hot_files # Override hidden defaults

# Hidden defaults: compression.{hot_files.load,file_edit,file_edit_input,message}, file-cleanup.run, memory.hook
```

**Patterns:**

- App: Simple names, mixed context - `logger.info("develop-store.init.start", { message, appId })`
- Agents: Hierarchical, rich context - `logger.warn("conversation.history.tool_call.skipped", { conversationId, toolCallId, reason })`

**Exclusions:** `app-templates/v8/`, `**/*.test.{ts,tsx}`, `**/__tests__/**`, `src/generated/`

## Coding Standards

<code_comments>
Prefer self-documenting code. Comment only for: WHY, WTF moments, complex regex, external constraints. Comments rot, code doesn't. See `.cursor/rules/comments.mdc`.
</code_comments>

<dependency_validation>
Declare in `package.json` BEFORE import. `dependencies` (runtime), `devDependencies` (dev/test). Node.js core (`node:`) exempt. Ensures reproducible builds, prevents production errors.
</dependency_validation>

<react_component_architecture>
**website/ only:** Extract complex UI (>5-10 JSX lines) to `components/` with clear names and TypeScript props. Improves reusability, testability, maintainability.
</react_component_architecture>

## Package Management

<pnpm_requirement>
Use **pnpm** only (never `npm`). Better performance (content-addressable), stricter resolution (no phantom deps), efficient workspaces. Lockfile is pnpm-specific.

```bash
pnpm install / run dev / test / run lint
pnpm --filter @airo/agents add <pkg>       # Workspace dependency
pnpm --filter website add -D <pkg>         # Dev dependency
```

</pnpm_requirement>

## Pull Request Guidelines

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes tested
- [ ] Backward compatibility verified
