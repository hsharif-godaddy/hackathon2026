# Agents Rules and Guidance

**Read this before writing, editing, or executing anything in this repo.**

## Project Overview

Airo Builder: AI-powered app development platform with multi-service architecture, AI agents, real-time collaboration, and flexible deployment.

## General Rules

<critical_file_safety>
Files under `/tmp/airo-app-builder/{appId}/preview/**` are generated OUTPUT. Fix generation logic in source, not output files.

**V4 Directory Structure:**

- `/tmp/airo-app-builder/{appId}/preview/` - Agent workspace (agent writes here)
- `/tmp/airo-app-builder/{appId}/publish/` - Publish workspace (separate from preview)
- `/tmp/airo-app-builder/{appId}/git-repo/` - Git repository (.git directory, bind-mounted)
- `/tmp/airo-app-builder/{appId}/assets/` - Assets directory (public/private, bind-mounted)
- `/tmp/airo-app-builder/{appId}/dist/` - Distribution tarballs
- `/tmp/airo-app-builder/{appId}/alloc/` - Configuration and secrets
  </critical_file_safety>

<code_quality_standards>

- Be direct and concise, challenge solutions when you have better alternatives
- Validate props/imports/paths exist before use - read files, don't assume
- Ask clarifying questions when ambiguous
- Read and understand code before proposing changes - never speculate
  </code_quality_standards>

<product_context_requirement>
**MANDATORY: Ask which product before designing any feature.**

This codebase serves TWO products with different architectures:

| Product                  | Architecture | Data Flow                                  |
| ------------------------ | ------------ | ------------------------------------------ |
| **AiroAppBuilder (AAB)** | Full stack   | UI (app/) → BFF → Agents API               |
| **PaaS**                 | Headless     | External UI → V2 API / Agents API directly |

**Before implementing any feature, ASK:**

> "Is this feature for AiroAppBuilder, PaaS, or both?"

The answer determines:

- Which APIs to use
- Whether data comes from database or request body
- Which services are available (secrets API, app database, etc.)

**Key Architectural Differences:**

| Aspect                | AiroAppBuilder (AAB)                                 | PaaS                                                 |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| **App Record**        | Exists in agents SQLite `apps` table                 | May NOT exist in agents database                     |
| **App Path**          | Retrieved via `appRepository.findById()`             | Must be passed in request OR derived from convention |
| **Secrets/Tokens**    | Stored via `/api/secrets` → `/alloc/config.json`     | Passed directly in API request body                  |
| **Git Remote Config** | Stored in `git_remote_config` table                  | Passed in request (`repoUrl`, `token`)               |
| **Authentication**    | GoDaddy SSO via app/ BFF                             | Direct API auth (V2 tokens, API keys)                |
| **Container Access**  | Via `DevSupervisorClientFactory.createForApp(appId)` | Same, but appId must be valid                        |

**Implementation Pattern:**

```typescript
// Check if PaaS pattern (direct params) or AAB pattern (database lookup)
if (options.token && options.repoUrl) {
  // PaaS: Use values from request directly
  repoUrl = options.repoUrl;
  token = options.token;
} else {
  // AAB: Look up from database / config
  const config = repository.findByAppId(appId);
  repoUrl = config.repoUrl;
  token = getNomadAllocConfig()?.GITHUB_TOKEN?.VALUE;
}
```

</product_context_requirement>

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
corepack enable                     # Enable Corepack (enforces pnpm 10.17.0)
./setup.sh                          # Automated setup
pnpm --filter airo-setup start      # Selective config
pnpm install && pnpm run dev        # Manual: agents:4000, app:3000
```

**Development:**

```bash
pnpm typecheck / lint / test / test:e2e / build / build:all
pnpm --filter @airo/agents test:unit / test:integration
pnpm --filter <package> build

# dev-supervisor (Go project)
cd dev-supervisor && go fmt ./...
cd dev-supervisor && golangci-lint run
```

**Test Filtering (Vitest):**

```bash
# IMPORTANT: Always filter to a specific package first
pnpm --filter @airo/agents test:unit "pattern"      # Filter by file path
pnpm --filter @airo/agents test:unit -t "test name" # Filter by test name
pnpm --filter website test "pattern"                # App package tests

# DO NOT use root "pnpm test -- filter" - causes OOM by running all packages
```

| What you want       | Vitest syntax | Jest syntax (DON'T USE) |
| ------------------- | ------------- | ----------------------- |
| Filter by file      | `"pattern"`   | `--testPathPattern`     |
| Filter by test name | `-t "name"`   | `--testNamePattern`     |

**Ports:** Agents=4000, App=3000. Kill conflicting processes.

## Architecture

**pnpm workspace monorepo** - Always use `pnpm`, never `npm`. Corepack enforces pnpm 10.17.0 from `package.json` `packageManager` field.

### Core Services

| Service             | Package        | Port | Purpose                                                                                                                      |
| ------------------- | -------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| **agents/**         | `@airo/agents` | 4000 | Express API, agent registry, app lifecycle, SQLite, WebSocket - see [agents/CLAUDE.md](agents/CLAUDE.md)                     |
| **app/**            | `website`      | 3000 | Next.js builder UI, Monaco, chat, MySQL/Prisma, GoDaddy SSO, UXCore                                                          |
| **proxy/**          | `airo-proxy`   | N/A  | Getty Images API proxy with SSO authentication                                                                               |
| **dev-supervisor/** | Go project     | N/A  | Go-based process supervisor with HTTP proxy, TLS, PID1 management - see [dev-supervisor/CLAUDE.md](dev-supervisor/CLAUDE.md) |

_Additional services:_ `website/` (marketing), `app-templates/` (v8 template), `packages/ai-lib/` (shared AI utils), `packages/design-extractor/` (PDF RAG), `setup/` (config utility), `e2e/` (E2E tests)

**See:** Root `package.json` workspaces for complete service list

### Key Patterns

**Deployment:**

- **Local Development**: Docker Compose via `docker-compose-generator.ts`
- **Test/Dev/Production Environments**: Nomad job templates in [mhp-core](https://github.com/gdcorp-partners/mhp-core) (external repo)
- **Deployment Adapter**: Always uses `DockerDeploymentAdapter` (`app/src/lib/deployment/docker-adapter.ts`)
- See: `app/DEPLOYMENT-ADAPTER-SYSTEM.md`

**Container Orchestration:**

- Location: `app/src/lib/dev-environment/`
- Files: `docker-compose-generator.ts`, `docker-compose-manager.ts`, `docker-container-manager.ts`
- Generated: `/tmp/airo-app-builder/{appId}/docker-compose.yml`
- **V4 Structure:** Separate preview/publish workspaces with bind-mounted git/assets
  - Preview workspace: `/tmp/airo-app-builder/{appId}/preview/` (agent writes here)
  - Publish workspace: `/tmp/airo-app-builder/{appId}/publish/` (tarball extraction)
  - Git repository: `/tmp/airo-app-builder/{appId}/git-repo/.git` (bind-mounted to both containers)
  - Assets: `/tmp/airo-app-builder/{appId}/assets/` (bind-mounted to both containers)
  - Config/secrets: `/tmp/airo-app-builder/{appId}/alloc/`

**HTTP Proxy (dev-supervisor):**

- **Purpose**: TLS termination, reverse proxy, WebSocket support, static asset serving
- **Location**: `dev-supervisor/` (Go service)
- **Key files**: `http_proxy.go`, `main.go`, `api.go`, `pid1_manager_unix.go`
- **Features**: Configurable retry/backoff, static serving with cache headers, SPA fallback
- **Config**: Environment variables (`DEV_SUPERVISOR_*` prefix) - see `dev-supervisor/main.go` for options

**App Lifecycle:** `creating` → `created` → `running`/`stopped`/`error`

- Async setup with auto recovery and cleanup
- **DO NOT edit** `/tmp/airo-app-builder/{appId}/preview/` or `/tmp/airo-app-builder/{appId}/publish/` (generated output)

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

### Initialization State Machine

**Overview:** XState v5 state machine managing develop page initialization lifecycle

**Location:** `app/src/app/develop/hooks/initializationMachine.ts` and `useInitialization.ts`

**Flow:** `idle` → `checkingCreation` → `creating` → `initializingPage` → `loadingHistory` → `ready` (with sub-phases: `waitingForWebSocket` → `websocketConnected` → `waitingForFirstEdit` → `active`)

**Critical Patterns:**

- **Token-based cancellation**: All async operations validate `initializationTokenRef` before firing events to prevent cross-app contamination
- **Job→App tracking**: `jobIdToRealAppIdRef` maps job IDs to real app IDs to prevent false positive RESET detection during navigation
- **AbortSignal**: HTTP requests use AbortController for proper cancellation on navigation
- **Context hydration**: `HYDRATE_APP` event updates machine context during job→app transition to keep logging/telemetry accurate

**Critical Rules:**

- Always validate `initializationTokenRef` before sending events from async operations
- Track job→app relationships in `jobIdToRealAppIdRef` on CREATION_SUCCEEDED
- Use AbortSignal for all HTTP requests that could span navigation
- Send `HYDRATE_APP` when appId changes to keep context synchronized
- RESET clears all refs to prevent stale state

### Database

**App (MySQL/Prisma):**

- Schema: `app/prisma/schema.prisma`
- Package: `website`
- Config: `app/.env` (`DATABASE_URL`)

```bash
# Apply migrations to database (updates DB schema)
pnpm --filter website exec prisma migrate dev

# Regenerate Prisma client (updates TypeScript types)
pnpm --filter website exec prisma generate

# Open Prisma Studio (database GUI)
pnpm --filter website exec prisma studio

# Push schema changes without creating migration
pnpm --filter website exec prisma db push
```

**After pulling schema changes:**

When you pull code with Prisma schema updates, you MUST run both:

1. `pnpm exec prisma generate` - Regenerates Prisma client types
2. `pnpm exec prisma migrate dev` - Applies database migrations

**Common Issues:**

- **Error: `Invalid prisma.sites.findMany() invocation: The column 'airo_app.sites.p...'`**
  - **Cause:** Database schema doesn't match Prisma schema (migrations not applied)
  - **Fix:** Run `cd app && pnpm exec prisma migrate dev`
  - **Prevention:** Always apply migrations after pulling schema changes

## Environment Config

**Configuration files:**

- Agents: `agents/.env.example` - see [agents/CLAUDE.md](agents/CLAUDE.md) for details
- App: `app/.env.example`

**Setup:** Use `./setup.sh` or `pnpm --filter airo-setup start` - don't create manually

**Key variables:**

- AI: `OPENAI_API_KEY`, `OPENAI_MODEL`
- Database: `DATABASE_URL` (app MySQL)
- Logging: `LOG_LEVEL`, `LOG_DOMAINS`

_See individual `.env.example` files for complete options_

## Logging Standards

<structured_logging_requirements>
Use `logger.info/warn/error("event.name", { data })` with typed interfaces and hierarchical names (`domain.operation.lifecycle`). No emojis. Enables production monitoring, filtering, aggregation.
</structured_logging_requirements>

<field_naming_conventions>
**ALWAYS use camelCase for all logging fields and APM labels:**

- ✅ `appId`, `customerId`, `jobId`, `pageName`, `promptLength`
- ❌ `app_id`, `customer_id`, `job_id`, `page_name`, `prompt_length`

This applies to:

- Logger data fields: `logger.info("event", { appId, customerId })`
- APM span attributes: `setSpanAttribute('appId', value)`
- APM transaction labels: `transaction.addLabels({ appId, pageName })`
- Client log shipping: `shipAnalyticsLog("event", { appId })`

**Exception:** Database columns and Elasticsearch query fields may use snake_case per their external conventions.
</field_naming_conventions>

**Pattern:**

```typescript
logger.info("app.create.begin", { appId, name, templateVersion });
logger.error("conversation.load.failure", {
  appId,
  conversationId,
  error: getErrorMessage(error),
});
```

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

## Authentication & JWT Standards

<jwt_authentication_requirements>
**ALWAYS use gd-auth library methods instead of custom JWT validation.**

The `gd-auth` library correctly handles all authentication types (basic auth, impersonation, delegation chains) and token expiration rules. Custom JWT validation code is error-prone and duplicates library functionality.
</jwt_authentication_requirements>

### gd-auth Configuration

**Location:** `app/src/lib/gd-auth-service.ts`

**Required configuration:**

```typescript
this.gdAuth = new GdAuth({
  app: "airo-builder",
  type: "idp",
  auths: authUtils.getSupportedAuthTypes(), // All supported auth types
  allowHeartbeat: true,
  use12HourExpiration: true, // REQUIRED: Enforces gateway token age limits
  fetchKey: require("gd-auth/src/fetch-key"),
});

// Use level=2 (medium risk) for token validation
const jwt = await this.gdAuth.authenticate(ssoHost, token, 2);
```

**Supported auth types (12 total - from gd-auth source):**

- `basic` - Normal authentication
- `e2s` - Employee-to-shopper impersonation
- `s2s` - Shopper-to-shopper delegation
- `e2s2s` - Employee-to-shopper-to-shopper
- `e2s2p` - Employee-to-shopper-to-partner
- `e2s2snpr` - Employee-to-shopper-to-shopper (NPR)
- `e2s2s2p` - Employee-to-shopper-to-shopper-to-partner
- `cert2s` - Certificate-to-shopper
- `e2p` - Employee-to-partner
- `s2p` - Shopper-to-partner
- `s2snpr` - Shopper-to-shopper (non-personalized reseller)
- `s2s2p` - Shopper-to-shopper-to-partner

**IMPORTANT:** gd-auth validates tokens against this list. If a token's auth type is not included, gd-auth throws `TokenAuthMismatchError` and rejects it. This list cannot be obtained from gd-auth - it must be maintained in `authUtils.getSupportedAuthTypes()`.

**Why `use12HourExpiration: true` is critical:**

- Enforces 12-hour IAT limit for per=true tokens (1-hour for per=false)
- Correctly skips VAT validation for e2s tokens (e2s tokens are NOT heartbeated)
- Enforces 5-minute VAT limit for basic/s2s tokens (heartbeat required)
- Matches gateway requirements exactly

### Use gd-auth Built-in Methods

**❌ DON'T write custom code:**

```typescript
// DON'T manually decode JWT
const decoded = decodeJWT(token);
const shopperId = decoded.shopperId;
const customerId = decoded.cid;

// DON'T write custom expiration checks
if (Date.now() / 1000 > decoded.exp) { ... }
if (decoded.vat && Date.now() / 1000 - decoded.vat > 300) { ... }
```

**✅ DO use gd-auth methods:**

```typescript
// Extract shopper and customer IDs
const shopperId = jwt.getShopperId(); // Handles all auth types
const customerId = jwt.getCustomerId(); // Handles all auth types

// Access JWT properties directly
const exp = jwt.exp;
const iat = jwt.iat;
const authType = jwt.auth; // 'basic', 'e2s', 's2s'

// Expiration is automatically handled by gd-auth.authenticate()
// No custom expiration checks needed
```

### Token Expiration Rules

gd-auth enforces these rules automatically when `use12HourExpiration: true` and `level >= 2`:

| Auth Type | VAT Check | IAT Check                                   | Notes                                   |
| --------- | --------- | ------------------------------------------- | --------------------------------------- |
| **basic** | ≤ 5 min   | ≤ 12 hours (per=true) or 1 hour (per=false) | Heartbeat required                      |
| **e2s**   | SKIPPED   | ≤ 2 hours                                   | Employee impersonation, not heartbeated |
| **s2s**   | ≤ 5 min   | ≤ 12 hours (per=true) or 1 hour (per=false) | Shopper delegation, heartbeat required  |

**Never write custom code to check these rules** - gd-auth handles it correctly.

### Authentication Type Detection

```typescript
// Use gd-auth to detect auth type from token
import { authUtils } from "@/lib/features";

const authType = authUtils.detectAuthTypeFromToken(token);
// Returns: 'basic' | 'e2s' | 's2s'
```

### Common Mistakes

**❌ Mistake: Custom VAT validation that breaks e2s tokens**

```typescript
// DON'T DO THIS - breaks e2s tokens (they have no VAT claim)
if (token.vat && Date.now() / 1000 - token.vat > 300) {
  throw new Error("Token VAT expired");
}
```

**❌ Mistake: Manual token age calculations**

```typescript
// DON'T DO THIS - gd-auth handles this
const tokenAge = Date.now() / 1000 - token.iat;
if (tokenAge > 43200) {
  throw new Error("Token too old");
}
```

**✅ Correct: Trust gd-auth validation**

```typescript
// gd-auth.authenticate() returns valid jwt or throws
// No custom validation needed
const result = await gdAuthService.authenticate(token);
if (!result.valid) {
  // Token is invalid/expired - gd-auth already checked everything
  return { error: result.reason };
}
```

### Reference

- gd-auth library: `node_modules/gd-auth/`
- Service implementation: `app/src/lib/gd-auth-service.ts`
- Customer auth: `app/src/lib/customer-auth.ts`
- Feature detection: `app/src/lib/features.ts` (authUtils)

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
- Setup guide: `GETTING_STARTED.md` - Local development setup (run `./setup.sh`)
- Mock auth: `app/MOCK-AUTH-SETUP.md`
- **Agents security:** `agents/CLAUDE.md` - Authorization patterns and route protection

## Pull Request Guidelines

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes tested
- [ ] Backward compatibility verified
- [ ] **dev-supervisor only:** `go fmt ./...` and `golangci-lint run` pass
