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

**Auth pattern:** All protected routes use `withCustomerAuth()` (`src/lib/customer-auth.ts`), which validates gd-auth JWT and extracts appId/customerId. Sensitive operations use `withCustomerAuth(handler, { level: 3 })` for stricter HBI-based expiration (see [Tiered Auth Levels](#tiered-auth-levels) below).

**Agent communication is NOT through the BFF.** The browser talks directly to agents (port 4000) using a Bearer token obtained from `POST /api/auth/agent-token`. See `src/lib/agent-fetch.ts` — it includes circuit breaker (rejects if SSO expired) and retry on 401.

**Control Plane Adapter** (`src/lib/control-plane/`): Routes requests to mgmt-airo (production) or local-control-plane (local dev) via V2ControlPlaneAdapter.

### Key BFF Routes

| Route                            | Purpose                | Downstream                          |
| -------------------------------- | ---------------------- | ----------------------------------- |
| `GET/POST/DELETE /api/sites`     | Site management        | V2ControlPlaneAdapter → mgmt-airo   |
| `POST /api/auth/agent-token`     | JWT for agents service | JWT Service + paywall + switchboard |
| `GET /api/apps/[id]/deployments` | Deployment history     | mgmt-airo API                       |
| `GET /api/config`                | Feature flags + config | Returns flags                       |

### Slack feedback (Block Kit)

- **Format:** `src/lib/slack-webhook.ts` (`formatSlackBlockMessage` → `text` + `blocks` for incoming webhooks). Builders: `src/components/feedback/slackBuilders.ts`.
- **BFF route:** `POST /api/slack-webhook/feedback` — server-only env `SLACK_FEEDBACK_WEBHOOK_URL` (Katana: app secrets for airo build / website; same pattern as CI `SLACK_WEBHOOK_PROD` / `SLACK_WEBHOOK_NONPROD`).

**Local dev workflow (without `SLACK_FEEDBACK_WEBHOOK_URL` set):**

1. Submit any feedback form locally.
2. The route detects no webhook URL and echoes the `blockMessage` back to the client.
3. `sendFeedbackToSlack` in `submitFeedback.ts` (and the inline send block in `FeedbackForm.tsx`) calls `response.json()` and prints the full formatted JSON to the **browser console** via `console.log`.
4. Copy the JSON from the console.
5. Open [Slack Block Kit Builder](https://app.slack.com/block-kit-builder) and paste into the **Code** tab.
6. **If the preview errors:** the top-level `"text"` field is a common culprit — it is valid for real webhook POSTs but Block Kit Builder's Code tab does not accept it. Delete the `"text": "..."` line, preview your blocks, then add it back before posting to a real webhook.

**Live Slack delivery (optional, for end-to-end validation):**

Set `SLACK_FEEDBACK_WEBHOOK_URL` in your `app/.env.local`:

```
SLACK_FEEDBACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Retrieve the value from Katana secrets (app secrets for the `airo build / website` app). Avoid leaving this set during normal development — it posts to a shared channel and can confuse other team members. Remove it when you're done testing.

### Tiered Auth Levels

gd-auth supports three authentication levels. Default is level 1; sensitive operations use level 3.

| Level | Check | Expiration (persistent) | Expiration (non-persistent) |
| ----- | ----- | ----------------------- | --------------------------- |
| 1-2   | IAT   | <= 30 days              | <= 12 hours                 |
| 3     | HBI   | <= 12 hours             | <= 12 hours                 |

e2s (impersonation) tokens always use a fixed 2-hour expiration (no HBI claim).

**Usage:** Pass `{ level: 3 }` as the second argument to `withCustomerAuth`:

```typescript
export const POST = withCustomerAuth(
  async (request, authContext, routeContext) => {
    // handler
  },
  { level: 3 },
);
```

**Level 3 routes (require recent heartbeat):**

- **Financial/billing:** `subscriptions/renew` POST, `ecomm-subscription/auto-renew` POST, `entitlements/[subscriptionId]/update` PUT
- **Ownership/transfer:** `apps/[id]/transfer` POST+DELETE, `apps/[id]/transfer/cancel` POST, `transfer` POST (accept)
- **Deployment/publishing:** `sites/[id]/deploy` POST, `apps/[id]/deployments` POST, `apps/[id]/unpublish` POST
- **Secrets:** `secrets/[appId]/sync` POST, `secrets/[appId]/variants/[variant]` GET + POST
- **Deletion:** `sites/[id]` DELETE, `sites` DELETE (bulk)
- **Archive restore:** `sites/[id]/archive-restore` POST
- **DNS/domains:** `sites/[id]/domains` POST
- **Data export:** `apps/[id]/download` POST
- **Database writes:** `database/[appId]/tables/[tableName]/rows` POST, PUT, DELETE

**Intentionally level 1 (not level 3):**

- `sites/quick-create` POST — site creation. mhp-airo's `determineRiskLevel` returns `LOW_RISK` for every URL (packages/airo/src/middleware/auth.ts), so nothing downstream enforces HBI. Keeping this at level 1 avoids a re-auth loop from homepage/landing-page create buttons, which fire before any `authPreflight` runs.

**Config:** `use12HourExpiration` in `gasket-config.ts` (client-side, consumed by `@godaddy/gasket-auth`) maps to `useNewExpiration` in `gd-auth-service.ts` (server-side, consumed by `gd-auth` 1.5.0+). The two libraries use different property names for the same feature.

**Auth chain:** `withCustomerAuth(handler, { level })` -> `authenticateCustomer(request, level)` -> `gdAuthService.authenticate(token, level)` -> `gd-auth.authenticate(ssoHost, token, level)`

**When a 401 occurs at level 3:** gd-auth throws with `ssoCode: 2` (HBI expired). The middleware returns a 401 with `authReason: 2`. The client-side `AuthBoundary` shows a re-auth prompt.

## Feature Flags

Two-layer system:

**Layer 1 — Environment variables** (`src/lib/features.ts`): Static flags loaded at startup. `NEXT_PUBLIC_SHOW_CODE_EDITOR`, `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES`, etc.

**Layer 2 — GoDaddy Switchboard** (`src/lib/switchboard/`): Dynamic runtime flags loaded via `@godaddy/gasket-plugin-switchboard`. The plugin runs a singleton `@switchboard/client` that polls settings into an in-process cache (~2 min refresh) using IAM auth. `gasket.ts` configures `apps: ['@hivemind', 'airo-app-builder']` so both experiment cohorts and feature flags land in the same per-request tree.

- Server-side: `checkSwitchboardFlag(featureName, req)` / `checkSwitchboardValue(featureName, req)` in `src/lib/switchboard/server.ts`. `req` is anything with a `headers` field (NextRequest, Request, or `{ headers }`); the plugin uses it for criteria extraction.
- Client-side: `useSwitchboard(featureName)` in `src/hooks/useSwitchboard.ts` returns `boolean | undefined` synchronously from gasket-data. `undefined` = flag not in the loaded tree (SSR, or key missing). `getSwitchboardFlag` is an alias for non-component call sites.

**IAM grants (Switchboard Reader, already in place):**

The Switchboard **dev** and **test** environments are each granted the same three role patterns (which span CDK account `694282668781` for dev and `269423819739` for test):

- `arn:aws:iam::694282668781:role/*`
- `arn:aws:iam::694282668781:role/airobuilde-custom-*`
- `arn:aws:iam::269423819739:role/airobuilde-custom-*`

The Switchboard **prod** environment is granted:

- `arn:aws:iam::644094189644:role/airobuilde-custom-*`
- `arn:aws:iam::694282668781:role/airobuilde-custom-*`
- `arn:aws:iam::269423819739:role/airobuilde-custom-*`

Local dev inherits the dev grant when `AWS_PROFILE=airobuild-dev-private-sso` is set (account `694282668781`, PowerUser). Without those credentials (or without `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true`), flag lookups resolve to the defaults (`false` / `null`) - there is no automatic fallback.

**Local dev override:** When `NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true`, a subset of switchboard flags are forced to `true` before the client is consulted. The client and server allowlists differ — check `LOCAL_FEATURE_OVERRIDES` in `src/hooks/useSwitchboard.ts` (client) and `SERVER_LOCAL_FEATURE_OVERRIDES` in `src/lib/switchboard/server.ts` (server).

**Finding active flags:** Grep for `useSwitchboard(` and `checkSwitchboardFlag(` to find current flags.

**Layer 3 — Hivemind experiments** (A/B testing): Hivemind is GoDaddy's experimentation platform, separate from Switchboard but uses Switchboard under the hood for traffic splitting. Switchboard = simple feature flags (deploy/release decoupling). Hivemind = A/B experiments with metrics and analysis. Hivemind experiments are fetched via `gasket-plugin-switchboard` and serialized to the client through Gasket's data layer. Access client-side via `useGasketData()` → `switchboard` property or `useHivemind()` hook.

## Design System

**Use UXCore (`@ux/*`) exclusively in this package.** VPN required to install `@ux/*` packages (they come from GoDaddy Artifactory). References: `uxcore-llm.txt` (components), `uxcore-tailwind.md` (intent classes), `design-guidance.md`. UXCore storybook: [uxcore.uxp.gdcorp.tools](https://uxcore.uxp.gdcorp.tools/2500/?path=/docs/getting-started-overview--docs) (VPN).

- Read `uxcore-tailwind.md` before using any `intents-ux-` Tailwind classes
- NO default Tailwind colors (`bg-white`, `text-blue-600`) — use intent classes
- **`app-templates/` uses Shadcn/ui + Radix + Tailwind** — UXCore is NOT available in generated apps

## Internationalization (i18n)

Translations use react-intl via Gasket's `pluginIntl` (62 locales, default `en-US`). Translation strings are managed externally at [i18n.int.gdcorp.tools](https://i18n.int.gdcorp.tools/org/hcx/app/aab) — no locale JSON files in the repo.

**Usage:**

```typescript
import { useTranslations } from "@/hooks/useTranslations";

const t = useTranslations();
t("builder_publish_limit_title"); // Key only (preferred)
t("builder_publish_limit_plan_info", { planName, limit }); // With interpolation values
```

For JSX-embedded translations use `<FormattedMessage id="key" values={{ ... }} />`.

**Key structure:** `builder_{feature}_{element}` (e.g., `builder_settings_database_title`, `builder_common_retry`).

**Key files:** `src/hooks/useTranslations.ts` (hook), `src/lib/translations/load-translations.ts` (server-side loader), `src/components/providers/TranslationProvider.tsx` (provider), `gasket.ts` (locale config).

**Pre-commit validation:** Translation keys are validated automatically. Missing keys will block commits. Add missing keys via the i18n UI before committing.

**Full documentation:** See `src/lib/translations/README.md` for comprehensive translation guide covering client/server patterns, pluralization, rich text formatting, and API details.

## WebSocket Architecture

Socket.IO + XState v5 state machine for agent communication lifecycle.

**Two-tier pattern:**

- **Tier 1 (Lifecycle):** Machine → StoreSyncAdapter → Store (connection/streaming states)
- **Tier 2 (Data):** Handlers → Store directly (transcript, tool calls)

**Transport state flow:** `disconnected → connecting → authenticating → connected`. Connect-then-auth protocol: client connects without token, authenticates via `authenticate` event. Handshake-auth fallback for old servers.

**Critical rules:**

- Handlers NEVER call lifecycle methods (`setWebSocketState`, `setStreamingState`, `setIsLoading`)
- Lifecycle flows through Machine → Adapter → Store only
- Machine is REQUIRED in handler context (not optional)
- Always call `controller.destroy()` in cleanup
- Never store tokens in `socket.auth` after auth success (prevents reconnect data leak)

Key files: `src/services/websocket/webSocketMachine.ts`, `StoreSyncAdapter.ts`, `StreamingWebSocketController.ts`, `ConnectionManager.ts`. Handlers: `src/hooks/websocket/handlers/`.

Full docs: `docs/client-websocket-architecture.md`, `docs/ui-agents-authentication-architecture.md`. Tests: 390+ tests across 25 websocket test files.

## Shared Types (`@airo/shared`)

App uses `@airo/shared` for grants types, context-attachment, social types, and websocket types. App does **NOT** depend on `@airo/ai-lib` — shared types come from `@airo/shared`.

| Import path                       | Contents                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| `@airo/shared/grants`             | `CreditGrant`, `GrantType`, `GrantFinalState`, `GrantManager`        |
| `@airo/shared/context-attachment` | `ContextAttachment`, `createContextAttachment`                       |
| `@airo/shared/websocket`          | `AgentsAppContext`, `AgentsAppChatMessage`                           |
| `@airo/shared/social`             | `ValidationDetails`, `PostImageData`, `CONNECT_REQUEST_FROM_PUBLISH` |

## Initialization State Machine

XState v5 machine managing develop page lifecycle: `idle` → `checkingCreation` → `creating` → `initializingPage` → `loadingHistory` → `ready` (sub-phases: `waitingForWebSocket` → `websocketConnected` → `waitingForFirstEdit` → `active`).

Location: `src/app/develop/hooks/initializationMachine.ts` and `useInitialization.ts`.

**Critical patterns:**

- **Token-based cancellation:** Validate `initializationTokenRef` before firing events to prevent cross-app contamination
- **Job→App tracking:** `jobIdToRealAppIdRef` maps job IDs to real app IDs to prevent false RESET during navigation
- **AbortSignal:** All HTTP requests use AbortController for navigation cancellation
- **Context hydration:** Send `HYDRATE_APP` when appId changes to keep context synchronized
- RESET clears all refs

## Local Dev Logs

When running locally (`GASKET_ENV=local.*`), all stdout/stderr is automatically written to `app/dev.log` (ANSI codes stripped). The file is truncated on each restart. Use this log to troubleshoot issues — read it to see recent errors, startup failures, or unexpected behavior.

## Testing

```bash
pnpm --filter website test "pattern"           # By file path
pnpm --filter website test -- -t "test name"   # By test name
```

Vitest config: forks pool, dynamically scaled based on CPU cores, 512MB memory limit, 50% coverage threshold.

**Test environment:** Default is lightweight `node` environment. React component and hook tests require jsdom:

```typescript
/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
// ... your test
```

**When to use jsdom:**

- Tests that render React components (`render`, `renderHook`)
- Tests that use DOM APIs (`document`, `window`, `IntersectionObserver`)
- Tests that use `@testing-library/react` or `@testing-library/react-hooks`

**When NOT to use jsdom:**

- API route tests (Next.js route handlers)
- Utility function tests (pure logic)
- Service/adapter tests (no UI)
