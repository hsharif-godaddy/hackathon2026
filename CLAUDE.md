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
**Design System Boundaries:**

- **`/app` (Builder UI)**: Use UXCore design system (@ux/\*) exclusively
  - See `app/uxcore-llm.txt` and `app/design-guidance.md`
  - NO default Tailwind colors (`bg-white`, `text-blue-600`)
  - Prioritize accessibility and usability
- **`/app-templates` (Generated Apps)**: Use Shadcn/ui + Radix + Tailwind
  - UXCore is NOT available in generated applications
  - Follow template's existing component patterns
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

| Service             | Package        | Port | Purpose                                                             |
| ------------------- | -------------- | ---- | ------------------------------------------------------------------- |
| **agents/**         | `@airo/agents` | 4000 | Express API, agent registry, app lifecycle, SQLite, WebSocket       |
| **app/**            | `website`      | 3000 | Next.js builder UI, Monaco, chat, MySQL/Prisma, GoDaddy SSO, UXCore |
| **proxy/**          | `airo-proxy`   | N/A  | Getty Images API proxy with SSO authentication                      |
| **dev-supervisor/** | N/A            | N/A  | Go-based process supervisor with HTTP proxy, TLS, PID1 management   |

_Additional services:_ `website/` (marketing), `app-templates/` (v8 template), `packages/ai-lib/` (shared AI utils), `packages/design-extractor/` (PDF RAG), `setup/` (config utility), `e2e/` (E2E tests)

**See:** Root `package.json` workspaces for complete service list

### Key Patterns

**Deployment:** Docker Compose (dev/local), enterprise adapter (prod) via adapter pattern

- Implementation: `app/src/lib/dev-environment/adapters/DockerAppService.ts`
- See: `app/DEPLOYMENT-ADAPTER-SYSTEM.md`

**Container Orchestration:**

- Location: `app/src/lib/dev-environment/`
- Files: `docker-compose-generator.ts`, `docker-compose-manager.ts`, `docker-container-manager.ts`
- Generated: `/tmp/apps/{appId}/docker-compose.yml`
- Structure: `/tmp/apps/{appId}/app/` (code), `/tmp/apps/{appId}/alloc/` (config)

**HTTP Proxy (dev-supervisor):**

- **Purpose**: TLS termination, reverse proxy, WebSocket support, static asset serving
- **Location**: `dev-supervisor/` (Go service)
- **Key files**: `http_proxy.go`, `main.go`, `api.go`, `pid1_manager_unix.go`
- **Features**: Configurable retry/backoff, static serving with cache headers, SPA fallback
- **Config**: Environment variables (`DEV_SUPERVISOR_*` prefix) - see `dev-supervisor/main.go` for options

**App Lifecycle:** `creating` → `created` → `running`/`stopped`/`error`

- Async setup with auto recovery and cleanup
- **DO NOT edit** `/tmp/apps/{appId}/app/` (generated output)

### AI Agent System

**Registry & Base:**

- Base class: `agents/src/base/base-agent.ts`
- Registry: `agents/src/registry/agent-registry.ts`
- Factory: `agents/src/agents/ai-lib-agents/index.ts`
- Prompts: `agents/src/prompts/`

**Available Agents:** InitialAgent, DevelopAgent, DesignAgent, ColorSchemeAgent, MarketingAgent, CommerceAgent, ExampleAgent
_Explore `agents/src/agents/` directory for implementations_

**Feature Flags:**

- Configuration: `agents/src/services/features.ts`
- Key flags: `ENABLE_COMMERCE_AGENT`, `ENABLE_SOCIAL_PLATFORM`
- Usage: `agents.isEnabled("commerce")` / `agents.isEnabled("social")`

### Tools

**Location:** `agents/src/tools/`

**Categories:**

- File operations: file-edit, read-file, directory-listing
- Development: git-tool, terminal, grep-tool
- Code manipulation: ast-style-editor, ast-text-editor, ast-editor-base
- Infrastructure: server-management-tool, mysql-tool, secrets-management-tool, view-logs-tool
- AI: memory-tool, rag-tool, skill-loader-tool
- Media: media-search-tool (Getty/DALL-E integration)
- Specialized: commerce-product-tool, website-scraper-tool, app-plan-tool, css-color-tool, todo-list-tool, icons-validator

_Explore the tools directory for complete list and implementations_

### WebSocket Architecture

**Overview:** Socket.IO V2 + XState v5 state machine for lifecycle management

**Core Pattern:**

- **Tier 1 (Lifecycle)**: Machine → Adapter → Store (connection/streaming states)
- **Tier 2 (Data)**: Handlers → Store directly (transcript, tool calls)

**Key Files:**

- Machine: `app/src/services/websocket/webSocketMachine.ts`
- Adapter: `app/src/services/websocket/StoreSyncAdapter.ts`
- Controller: `app/src/services/websocket/StreamingWebSocketController.ts`
- Types: `app/src/services/websocket/stateMachineTypes.ts`
- Handlers: `app/src/hooks/websocket/handlers/`

**Critical Rules:**

- Handlers NEVER call lifecycle methods directly (setWebSocketState, setStreamingState, setIsLoading)
- Lifecycle changes flow through: Machine → Adapter → Store
- Machine is REQUIRED in handler context (not optional)
- Always call `controller.destroy()` in cleanup

**Documentation:** See `docs/client-websocket-architecture.md` for complete architecture details

**Testing:** 129 tests across 7 files - see `app/src/services/websocket/__tests__/`

### Database

**App (MySQL/Prisma):**

- Schema: `app/prisma/schema.prisma`
- Package: `website`
- Config: `app/.env` (`DATABASE_URL`)

```bash
pnpm --filter website exec prisma migrate dev / generate / studio
```

## Environment Config

**Configuration files:**

- Agents: `agents/.env.example`
- App: `app/.env.example`

**Key variables:**

- AI: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`
- Database: `MYSQL_ROOT_*` (agents), `DATABASE_URL` (app)
- Logging: `LOG_LEVEL`, `LOG_DOMAINS`, `LOG_DISABLED_DOMAINS`
- Features: `ENABLE_COMMERCE_AGENT`, `ENABLE_SOCIAL_PLATFORM`
- Media: `GETTY_API_URL`, `GETTY_TOKEN`, `IMAGE_SEARCH_DRIVER`

**Setup:** Use `./setup.sh` or `pnpm --filter airo-setup start` - don't create manually

_See `.env.example` files and `agents/src/services/features.ts` for complete configuration options_

## Logging Standards

<structured_logging_requirements>
Use `logger.info/warn/error("event.name", { data })` with typed interfaces and hierarchical names (`domain.operation.lifecycle`). No emojis. Enables production monitoring, filtering, aggregation.
</structured_logging_requirements>

**Pattern:**

```typescript
logger.info("app.create.begin", { appId, name, templateVersion });
logger.error("conversation.load.failure", {
  appId,
  conversationId,
  error: getErrorMessage(error),
});
```

**Event Categories:** `agents/src/logging/events/index.ts`

- appCreationEvents, appServerEvents, appDockerEvents, conversationHistoryEvents,
- webSocketConnectionEvents, toolGitEvents, toolFileEditEvents, llmEvents, and more

**Control:**

```bash
LOG_LEVEL=debug|info|warn|error|fatal
LOG_DOMAINS=app,websocket               # Allowlist
LOG_DISABLED_DOMAINS=compression,memory # Blocklist
LOG_OPT_IN_DOMAINS=compression.hot_files # Override hidden defaults
```

**See:** `LOGGING-GUIDE.md` for complete documentation

## Coding Standards

<code_comments>
Prefer self-documenting code. Comment only for: WHY, WTF moments, complex regex, external constraints. Comments rot, code doesn't.
</code_comments>

<dependency_validation>
Declare in `package.json` BEFORE import. `dependencies` (runtime), `devDependencies` (dev/test). Node.js core (`node:`) exempt. Ensures reproducible builds, prevents production errors.
</dependency_validation>

<react_component_architecture>
**app/ only:** Extract complex UI (>5-10 JSX lines) to `components/` with clear names and TypeScript props. Improves reusability, testability, maintainability.
</react_component_architecture>

<pnpm_requirement>
Use **pnpm** only (never `npm`). Better performance, stricter resolution, efficient workspaces.

```bash
pnpm --filter @airo/agents add <pkg>       # Workspace dependency
pnpm --filter website add -D <pkg>         # Dev dependency
```

</pnpm_requirement>

## Working with Claude

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

## Additional Documentation

- Architecture: `ARCHITECTURE_DOCUMENTATION.md`
- WebSocket: `docs/client-websocket-architecture.md`
- OAuth: `docs/oauth-architecture.md`
- Deployment: `app/DEPLOYMENT-ADAPTER-SYSTEM.md`
- Testing: `app/TESTING.md`
- Logging: `LOGGING-GUIDE.md`
- Local setup: `app/LOCAL_SETUP.md`
- Mock auth: `app/MOCK-AUTH-SETUP.md`

## Pull Request Guidelines

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes tested
- [ ] Backward compatibility verified
