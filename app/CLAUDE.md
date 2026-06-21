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

**Active Gasket plugins:** `pluginNextjs`, `pluginLogger`, `pluginWinston`, `pluginData`, `pluginWebpack`, `pluginSecurity`, `pluginTraffic`, `pluginVisitor`, `pluginAuth` (conditional), `pluginDevCerts`, `pluginAtlas`, `pluginHttpsProxy`, `pluginIntl` (62 locales), `pluginUxp`, `pluginOtel`, `pluginCds`, `pluginSwitchboard` (omitted when `GASKET_DISABLE_SWITCHBOARD=1` — use when internal IAM token DNS is unreachable without VPN).

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

Block Kit format lives in `src/lib/slack-webhook.ts` + `src/components/feedback/slackBuilders.ts`. **Slack delivery for feedback is owned by the fanout Lambda** (`airo-fanout-<env>`), triggered by the parquet write — the UI no longer posts to Slack directly (the legacy `POST /api/slack-webhook/feedback` route was removed once `appbuilder-fanout-via-lambda` reached 100%). The shared builders are still used client-side by `logDevFeedbackBlockMessage` to echo the Block Kit payload to the local-dev console for pasting into [Slack Block Kit Builder](https://app.slack.com/block-kit-builder) — strip the top-level `"text"` field for preview there.

### Tiered Auth Levels

gd-auth supports three authentication levels. Default is level 1; sensitive operations pass `{ level: 3 }` to `withCustomerAuth` for stricter HBI-based expiration.

| Level | Check | Persistent       | Non-persistent  |
| ----- | ----- | ---------------- | --------------- |
| 1-2   | IAT   | <= 30 days       | <= 12 hours     |
| 3     | HBI   | <= 12 hours      | <= 12 hours     |

e2s (impersonation) tokens: fixed 2-hour expiration, no HBI.

**Level 3 covers:** financial/billing, ownership transfer, deploy/publish/unpublish, secrets read+write, site deletion, archive restore, domain changes, data export, database writes. Grep `{ level: 3 }` for the current list. `sites/quick-create` is intentionally level 1 — mhp-airo classifies every URL as LOW_RISK, and gating it would trigger a re-auth loop from landing-page create buttons that fire before `authPreflight`. `api/github/callback` is intentionally level 1 — it's a cross-site redirect from github.com where no heartbeat occurs, so HBI (level 3) would falsely expire during the OAuth round-trip.

**Config mapping:** `use12HourExpiration` in `gasket-config.ts` (client, `@godaddy/gasket-auth`) ↔ `useNewExpiration` in `gd-auth-service.ts` (server, `gd-auth` 1.5.0+). A level-3 401 throws `ssoCode: 2`, returned to the client as `authReason: 2`, which triggers `AuthBoundary`'s re-auth prompt.

## Feature Flags

Two-layer system:

**Layer 1 — Environment/config variables** (`src/lib/features.ts`): Startup configuration such as `AUTH_TYPE` and dev-supervisor transport settings. Do not add feature rollout flags here; use Switchboard.

**Layer 2 — GoDaddy Switchboard** (`src/lib/switchboard/`): Dynamic runtime flags loaded via `@godaddy/gasket-plugin-switchboard`. The plugin runs a singleton `@switchboard/client` that polls settings into an in-process cache (~2 min refresh) using IAM auth. `gasket.ts` configures `apps: ['@hivemind', 'airo-app-builder']` so both experiment cohorts and feature flags land in the same per-request tree.

- Server-side: `checkSwitchboardFlag(featureName, req)` / `checkSwitchboardValue(featureName, req)` in `src/lib/switchboard/server.ts`. `req` is anything with a `headers` field (NextRequest, Request, or `{ headers }`); the plugin uses it for criteria extraction.
- Client-side: `useSwitchboard(featureName)` in `src/hooks/useSwitchboard.ts` returns `boolean | undefined` synchronously from gasket-data. `undefined` = flag not in the loaded tree (SSR, or key missing). `getSwitchboardFlag` is an alias for non-component call sites.

Local dev inherits the Switchboard Reader dev grant when `AWS_PROFILE=airobuild-dev-private-sso` is set. Without it, flag lookups resolve to defaults (`false` / `null`) — no automatic fallback. Grep for `useSwitchboard(` / `checkSwitchboardFlag(` to find active flags.

**Flag naming convention:** `appbuilder-{feature}` in kebab-case (e.g. `appbuilder-share-links`, `appbuilder-model-selector`).

**Active flags (non-exhaustive):**

| Flag | Default | Purpose | Env |
| ---- | ------- | ------- | --- |
| `appbuilder-crm-case-create` | `false` | Gates direct CRM case creation from the feedback form (legacy path, superseded by `appbuilder-fanout-via-lambda`) | dev, test, prod |
| `appbuilder-fanout-via-lambda` | `false` | Gates the per-submission fanout Lambda (`airo-fanout-<env>`) for issue/support/feedback. The BFF writes parquet to S3 and async-invokes the Lambda, which owns Slack + CRM (issue/support only) + AABSP Jira (driven by `appbuilder-fanout-jira-eligibility`; default feedback rating<7 only, issue/support OFF). The AiroInvestigator was removed from this path. **Now a server-side kill switch only** — at 100% the UI legacy fallback was removed, so the UI always writes the parquet (+ companion hub) and never fans out directly; the BFF (`s3-store` route) reads this flag to stamp the `fanout_via_lambda` parquet column and the Lambda no-ops when it is not strictly `true`. **The companion-hub write is flag-independent** — the UI calls it on every submission because the hub API requires the authenticated browser session the Lambda lacks; the Lambda never writes companion hub. Must be registered in dev, test, and prod Switchboard. | dev, test, prod |
| `appbuilder-rebuild-intake-form` | `false` | Initial rebuild only: show scope/design intake in develop chat before scraping; embedded in agent JWT as `rebuildIntakeFormEnabled`. Follow-up rebuilds (`initialBuildComplete`) skip intake even when flag is on. | dev (create in test/prod before rollout) |
| `appbuilder-skill-suggestions` | `false` | Master switch for the pending-skills feature (e.g. online-appointments next steps). Embedded in agent JWT as `skillSuggestionsEnabled`. Gates both the "Continue building" next-actions chips (`NextActionsService`, read via `getActiveAgentContext()`) and the proactive session-start "what's new" announcements (`skill-announcements-context.ts`, threaded via `context.metadata` on WS + SSE). Off → next-actions shows LLM suggestions only and no announcements are injected. | dev (create in test/prod before rollout) |
| `appbuilder-fanout-jira-eligibility` | _(absent → Lambda default)_ | **JSON** single-value setting gating which categories/ratings the fanout Lambda opens an AABSP Jira ticket for. Shape: `{"issue":bool,"support":bool,"feedback":{"enabled":bool,"maxRating":number}}` (`maxRating` is a strict `rating < maxRating` threshold). The BFF resolves it via `checkSwitchboardObject` at submit time (gasket surfaces a json setting as an object), re-serializes to a canonical string, and stamps it into the parquet column `jira_eligibility_config`; the Lambda parses it (`fanout/jira-eligibility.mjs`). When absent/null/malformed, the Lambda applies its built-in default: **issue/support OFF, feedback ON with maxRating 7**. Flip this to re-enable Bug/SOS tickets or retune the feedback rating threshold — no redeploy. **Must be created as the `json` setting type** (a String-typed value reads back as non-object → null → default). A Switchboard flip affects only NEW submissions (parquet replays use the value stamped at original submit time). | dev, test, prod |

**Setting up a flag for local development:**

1. Make sure `AWS_PROFILE=airobuild-dev-private-sso` is set — without it, all flags resolve to `false`/`null`.
2. Go to [https://switchboard.int.dev-gdcorp.tools/airo-app-builder](https://switchboard.int.dev-gdcorp.tools/airo-app-builder) and create the flag (type `boolean` for feature gates, default `false`).
3. Add yourself as an override: in the **Overrides** section, enter your shopper ID and set the value to `true`. This targets only you without affecting other users.
4. Flag changes propagate within ~2 minutes (the in-process cache refresh interval).
5. Create the flag in test and prod Switchboard environments when you're ready to roll out: [test](https://switchboard.int.test-gdcorp.tools/airo-app-builder), [prod](https://switchboard.int.gdcorp.tools/airo-app-builder).

To find your shopper ID: check the GoDaddy CRM or look for `shopperId` in your SSO JWT claims.

**Layer 3 — Hivemind experiments** (A/B testing): Hivemind is GoDaddy's experimentation platform, separate from Switchboard but uses Switchboard under the hood for traffic splitting. Switchboard = simple feature flags (deploy/release decoupling). Hivemind = A/B experiments with metrics and analysis. Hivemind experiments are fetched via `gasket-plugin-switchboard` and serialized to the client through Gasket's data layer. Access client-side via `useGasketData()` → `switchboard` property or `useHivemind()` hook.

**`appbuilder-agent-profile` ↔ `airo-build-initial-agent` precedence.** The `appbuilder-agent-profile` Switchboard value is overloaded: it sets both the deployed default agent profile AND any targeted internal-account overrides (e.g. `prompt-enhancer` for QA). To let the `airo-build-initial-agent` Hivemind experiment take effect for normal users while preserving operator overrides for internal accounts, the agent-token route treats two Switchboard values as sentinels meaning "no operator override — defer to Hivemind": `'default'` and `'hivemind'`. Real profile names always win over the experiment. Cohort → profile mapping lives in `app/src/config/experiments.ts` (`INITIAL_AGENT_COHORT_TO_PROFILE`); only one agent-config experiment should run at a time. To run the experiment in any environment, set the Switchboard default for `appbuilder-agent-profile` to `'hivemind'` (or `'default'`) and keep targeted overrides as real profile names.

## Design System

**Use UXCore (`@ux/*`) exclusively in this package.** VPN required to install `@ux/*` packages (they come from GoDaddy Artifactory). References: `uxcore-llm.txt` (components), `uxcore-tailwind.md` (intent classes), `design-guidance.md`. UXCore storybook: [uxcore.uxp.gdcorp.tools](https://uxcore.uxp.gdcorp.tools/2500/?path=/docs/getting-started-overview--docs) (VPN).

- Read `uxcore-tailwind.md` before using any `intents-ux-` Tailwind classes
- NO default Tailwind colors (`bg-white`, `text-blue-600`) — use intent classes
- **`app-templates/` uses Shadcn/ui + Radix + Tailwind** — UXCore is NOT available in generated apps

## Internationalization (i18n)

Translations use react-intl via Gasket's `pluginIntl` — strings managed externally at [i18n.int.gdcorp.tools](https://i18n.int.gdcorp.tools/org/airo-app-builder/app/aab), no locale JSON in the repo. Use `useTranslations()` from `@/hooks/useTranslations` for `t(key, values)`, or `<FormattedMessage id="key" values={...} />` in JSX. Key convention: `builder_{feature}_{element}`. Missing keys block pre-commit. Full guide: `src/lib/translations/README.md`.

## Chat Transport (SSE)

Chat streaming uses Server-Sent Events as the **only** transport. (The legacy Socket.IO + XState WebSocket transport was removed in AIROBUILD-2629; `xstate` itself stays — it still drives archive/restore and develop-init.)

**Entry point:** `src/hooks/useChatTransport.ts` is a thin wrapper that returns `useSSEChat` — call sites depend on the transport-neutral name. There is no transport selection.

**Key files:**

- `src/hooks/useSSEChat.ts` — the chat hook: opens the SSE stream, dispatches events into the store, drives sends/stop/history.
- `src/services/transport/SSETransport.ts` — EventSource/`fetch` stream lifecycle; `SSEQualityMonitor.ts` — connect/latency telemetry.
- `src/services/transport/buffering/` — `storeUpdateBuffer`, `toolDeltaBuffer`, `rafScheduler` (RAF-coalesced store writes; transport-neutral).
- `src/services/transport/messageTypes.ts` — chat-message contract types (`SendMessageOptions`, `AIEditContext`, `CustomContext`, …).
- `src/services/transport/composerAttachments.ts` — composer payload helpers.
- `src/hooks/chat/useChatHelpers.ts` — cookie/metadata/completion helpers; `src/hooks/chat/actions/` — client-action executors (`clientActionExecutors`, typed by the minimal `ClientActionContext`).
- `src/hooks/shared/` — `completionSideEffects.ts`, `toolMappers.ts`, `toolSideEffects.ts`: side-effect logic shared across the chat path.

**Connection state:** lives on the store `connection` field (`useConnectionState` selector, `setConnectionState` setter) — written by `useSSEChat` for the debug drawer. SSE reconnect is stateless per request (`Last-Event-ID`); there is no connection state machine, recovery handshake, or ACK protocol.

**Out-of-band server pushes** (`build_phase`, `logo`, `video`, `oauth_result`, `media_caption`) arrive over the same SSE event stream via the agents `EventStreamRegistry`. `media_caption` is fanned out by `emitMediaCaption` (`agents/src/server/media-caption-emit.ts`) after async caption generation; `useSSEChat`'s `media_caption` branch calls `handleMediaCaptionNotification`, which patches the media-slot + manifest React Query caches so captions surface live without a manifest refetch (AIROBUILD-2680).

Auth docs: `docs/ui-agents-authentication-architecture.md`.

## Shared Types (`@airo/shared`)

App uses `@airo/shared` for grants types, context-attachment, social types, and websocket types. App does **NOT** depend on `@airo/ai-lib` — shared types come from `@airo/shared`.

| Import path                       | Contents                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| `@airo/shared/grants`             | `CreditGrant`, `GrantType`, `GrantFinalState`, `GrantManager`        |
| `@airo/shared/context-attachment` | `ContextAttachment`, `createContextAttachment`                       |
| `@airo/shared/websocket`          | `AgentsAppContext`, `AgentsAppChatMessage`                           |
| `@airo/shared/social`             | `ValidationDetails`, `PostImageData`, `CONNECT_REQUEST_FROM_PUBLISH` |

## Initialization State Machine

XState v5 machine at `src/app/develop/hooks/initializationMachine.ts` (+ `useInitialization.ts`) managing develop-page lifecycle. Critical invariants: validate `initializationTokenRef` before firing events (prevents cross-app contamination); `jobIdToRealAppIdRef` maps job IDs to real app IDs to prevent false RESET during navigation; all HTTP uses AbortController; send `HYDRATE_APP` when appId changes; RESET clears all refs.

## Local Dev Logs

When running locally (`GASKET_ENV=local.*`), all stdout/stderr is automatically written to `app/dev.log` (ANSI codes stripped). The file is truncated on each restart. Use this log to troubleshoot issues — read it to see recent errors, startup failures, or unexpected behavior.

## Commands

```bash
pnpm --filter website typecheck                # Type check
pnpm --filter website lint                     # Lint
pnpm --filter website lint:fix                 # Lint with auto-fix
pnpm --filter website build                    # Build (runs gasket build + next build)
pnpm --filter website test "pattern"           # Test by file path
pnpm --filter website test -- -t "test name"   # Test by name
```

Vitest, forks pool. Default environment is `node` — add `@vitest-environment jsdom` docblock for tests that render React, use `@testing-library/react`, or touch DOM APIs. Keep API route / utility / adapter tests on `node`.
