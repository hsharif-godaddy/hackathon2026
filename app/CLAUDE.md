# App Service (Builder UI)

Next.js app (port 3000) serving the Airo Builder UI and BFF layer. Package: `website`. Built on GoDaddy's **Gasket** plugin framework.

## Gasket Framework

Gasket is GoDaddy's internal plugin-based framework that wraps Next.js. It uses a three-tier architecture (Plugins → Presets → Templates) and provides HTTPS proxying, authentication, i18n, feature flags, and server-side data serialization. Docs: [gasket.dev](https://gasket.dev/) (public), [godaddy.gasket.dev](https://godaddy.gasket.dev/) (internal). Source: [github.com/gdcorp-uxp/gasket](https://github.com/gdcorp-uxp/gasket).

**Key config files:**
- `gasket.ts` — Main config: plugins, environment-specific settings, auth, i18n, switchboard
- `gasket.edge.ts` — Minimal config for Next.js Middleware (only `pluginVisitor`, since Middleware can't use Node runtime)
- `next.config.js` — Delegates to Gasket: `gasket.actions.getNextConfig()`
- `server.ts` — Starts Gasket HTTPS proxy: `gasket.actions.startProxyServer()`

**Environment switching via `GASKET_ENV`:**
- `local.dev` — HTTPS proxy on `:8443` → Next.js on `:3000`, dev certs. Access via `https://local.gasket.dev-godaddy.com:8443`
- `local.test` / `local.prod` — Self-signed certs pointing at test/prod SSO
- `development`, `test`, `production` — Deployed environments

**This is NOT standard Next.js.** Key differences:
- HTTPS proxy layer sits in front of Next.js (Gasket handles TLS, not Next.js)
- Auth plugin conditionally loaded based on `AUTH_TYPE` env var (JWT mode vs mock)
- `pluginVisitor` must load before `pluginAuth` (populates `visitor.hostname` for SSO)
- Locale detection via Gasket's `resolveGasketData()`, not Next.js i18n (`nextRouting: false`)
- Server data serialized to client via `withGasketData()` / `useGasketData()` (i18n, switchboard flags, Hivemind experiments)
- Build requires `tsx gasket.ts build` before `next build` (generates `gasket-data.js`, intl manifests)

**Active Gasket plugins:** `pluginNextjs`, `pluginLogger`, `pluginWinston`, `pluginData`, `pluginWebpack`, `pluginSecurity`, `pluginTraffic`, `pluginVisitor`, `pluginAuth` (conditional), `pluginDevCerts`, `pluginAtlas`, `pluginHttpsProxy`, `pluginIntl` (62 locales), `pluginUxp`, `pluginOtel`, `pluginCds`, `pluginSwitchboard`.

## BFF Layer

The BFF is Next.js App Router API routes at `src/app/api/`. It does NOT just proxy — it handles auth, paywall checks, feature flags, data transformation, and OpenTelemetry context.

**Auth pattern:** All protected routes use `withCustomerAuth()` (`src/lib/customer-auth.ts`), which validates gd-auth JWT and extracts appId/customerId.

**Agent communication is NOT through the BFF.** The browser talks directly to agents (port 4000) using a Bearer token obtained from `POST /api/auth/agent-token`. See `src/lib/agent-fetch.ts` — it includes circuit breaker (rejects if SSO expired) and retry on 401.

**Control Plane Adapter** (`src/lib/control-plane/`): Routes requests to either V2 (mgmt-airo) or Legacy (local database) based on `USE_V2_CONTROL_PLANE` flag. Don't hardcode V2 vs Legacy logic — use the adapter.

### Key BFF Routes

| Route | Purpose | Downstream |
| ----- | ------- | ---------- |
| `POST /api/apps/create` | Create app | SiteAdapterFactory |
| `GET/POST/DELETE /api/sites` | Site management | Control Plane Adapter |
| `POST /api/auth/agent-token` | JWT for agents service | JWT Service + paywall + switchboard |
| `GET /api/apps/[id]/deployments` | Deployment history | mgmt-airo API |
| `GET /api/config` | Feature flags + config | Returns flags |

## Feature Flags

Two-layer system:

**Layer 1 — Environment variables** (`src/lib/features.ts`): Static flags loaded at startup. `NEXT_PUBLIC_SHOW_CODE_EDITOR`, `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES`, etc.

**Layer 2 — GoDaddy Switchboard** (`src/lib/switchboard/`): Dynamic runtime flags from `https://bff.pcx.{rootDomain}/api/config/feature/`.

- Server-side: `checkSwitchboardFlag(featureName, jwt, headers)` in `src/lib/switchboard/server.ts`
- Client-side: `useSwitchboard(featureName)` hook in `src/hooks/useSwitchboard.ts` (React Query, 5-min stale time)

**Local dev override:** When `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true`, a subset of switchboard flags are forced to `true`. The client and server allowlists differ — check `LOCAL_FEATURE_OVERRIDES` in `src/hooks/useSwitchboard.ts` (client) and `localOverrides` in `src/lib/switchboard/server.ts` (server).

**Active switchboard flags:** `appbuilder-publish-button`, `appbuilder-manage-plan`, `appbuilder-settings-team`, `appbuilder-domain-purchase`, `appbuilder-domain-attach`, `appbuilder-share-links`, `app-builder-grants`, `app-builder-bypass-publish-limit`.

**Layer 3 — Hivemind experiments** (A/B testing): Hivemind is GoDaddy's experimentation platform, separate from Switchboard but uses Switchboard under the hood for traffic splitting. Switchboard = simple feature flags (deploy/release decoupling). Hivemind = A/B experiments with metrics and analysis. Hivemind experiments are fetched via `gasket-plugin-switchboard` and serialized to the client through Gasket's data layer. Access client-side via `useGasketData()` → `switchboard` property or `useHivemind()` hook.

## Design System

**Use UXCore (`@ux/*`) exclusively in this package.** VPN required to install `@ux/*` packages (they come from GoDaddy Artifactory). References: `uxcore-llm.txt` (components), `uxcore-tailwind.md` (intent classes), `design-guidance.md`. UXCore storybook: [uxcore.uxp.gdcorp.tools](https://uxcore.uxp.gdcorp.tools/2500/?path=/docs/getting-started-overview--docs) (VPN).

- Read `uxcore-tailwind.md` before using any `intents-ux-` Tailwind classes
- NO default Tailwind colors (`bg-white`, `text-blue-600`) — use intent classes
- **`app-templates/` uses Shadcn/ui + Radix + Tailwind** — UXCore is NOT available in generated apps

## Database (MySQL/Prisma)

Schema: `prisma/schema.prisma`. Config: `.env` (`DATABASE_URL`).

```bash
pnpm --filter website exec prisma migrate dev   # Apply migrations
pnpm --filter website exec prisma generate       # Regenerate client types
pnpm --filter website exec prisma studio         # Database GUI
```

**After pulling schema changes, ALWAYS run both `prisma generate` AND `prisma migrate dev`.** Common error when you forget: `Invalid prisma.sites.findMany() invocation: The column 'airo_app.sites.p...'`

## WebSocket Architecture

Socket.IO + XState v5 state machine for agent communication lifecycle.

**Two-tier pattern:**
- **Tier 1 (Lifecycle):** Machine → StoreSyncAdapter → Store (connection/streaming states)
- **Tier 2 (Data):** Handlers → Store directly (transcript, tool calls)

**Critical rules:**
- Handlers NEVER call lifecycle methods (`setWebSocketState`, `setStreamingState`, `setIsLoading`)
- Lifecycle flows through Machine → Adapter → Store only
- Machine is REQUIRED in handler context (not optional)
- Always call `controller.destroy()` in cleanup

Key files: `src/services/websocket/webSocketMachine.ts`, `StoreSyncAdapter.ts`, `StreamingWebSocketController.ts`. Handlers: `src/hooks/websocket/handlers/`.

Full docs: `docs/client-websocket-architecture.md`. Tests: 129 tests in `src/services/websocket/__tests__/`.

## Initialization State Machine

XState v5 machine managing develop page lifecycle: `idle` → `checkingCreation` → `creating` → `initializingPage` → `loadingHistory` → `ready` (sub-phases: `waitingForWebSocket` → `websocketConnected` → `waitingForFirstEdit` → `active`).

Location: `src/app/develop/hooks/initializationMachine.ts` and `useInitialization.ts`.

**Critical patterns:**
- **Token-based cancellation:** Validate `initializationTokenRef` before firing events to prevent cross-app contamination
- **Job→App tracking:** `jobIdToRealAppIdRef` maps job IDs to real app IDs to prevent false RESET during navigation
- **AbortSignal:** All HTTP requests use AbortController for navigation cancellation
- **Context hydration:** Send `HYDRATE_APP` when appId changes to keep context synchronized
- RESET clears all refs

## Testing

```bash
pnpm --filter website test "pattern"           # By file path
pnpm --filter website test -- -t "test name"   # By test name
```

Vitest config: forks pool, max 4 forks, 5 concurrent per file, 512MB memory limit, 50% coverage threshold.
