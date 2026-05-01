# Airo Builder

AI-powered app development platform. Multi-service architecture with AI agents, real-time collaboration, and flexible deployment.

**CRITICAL: Always read existing code before modifying it. Verify refactors with `git diff` to ensure unchanged logic paths remain identical.**

## Deployment Topology

**Production:** One agent + preview + publish per app, deployed together as a Nomad job. The `app` (management UI) is a separate Katana deployment. Job allocation managed by [mhp-core](https://github.com/gdcorp-partners/mhp-core) control plane (mgmt-airo).

**Local dev:** Agent and app processes run on host. Preview and publish containers run in Docker, managed by the `local-control-plane` Go service (`local-control-plane/`) which provides a local mgmt-airo-compatible API backed by SQLite + Docker compose.

**App creation flow:** User clicks create → BFF calls mhp-core management service → control plane allocates Nomad job → user redirected to job instance running agent/preview/publish containers.

## Dual-Product Architecture

This codebase serves two products. Some features need product-gating.

| Product                  | Architecture | Data Flow                                  |
| ------------------------ | ------------ | ------------------------------------------ |
| **AiroAppBuilder (AAB)** | Full stack   | UI (app/) → BFF → Agents API               |
| **PaaS**                 | Headless     | External UI → V2 API / Agents API directly |

| Aspect             | AAB                               | PaaS                                   |
| ------------------ | --------------------------------- | -------------------------------------- |
| **App Record**     | SQLite `apps` table in agents     | May not exist in agents DB             |
| **Secrets/Tokens** | Stored via `/api/secrets` → alloc | Passed in API request body             |
| **Git Config**     | `git_remote_config` table         | Passed in request (`repoUrl`, `token`) |
| **Auth**           | GoDaddy SSO via app/ BFF          | Direct API auth                        |

```typescript
// Standard dual-product pattern
if (options.token && options.repoUrl) {
  // PaaS: values from request
} else {
  // AAB: lookup from database/config
}
```

## Services

| Service                    | Package              | Port | Notes                                                                           |
| -------------------------- | -------------------- | ---- | ------------------------------------------------------------------------------- |
| **agents/**                | `@airo/agents`       | 4000 | Express API, AI agents, SQLite, WebSocket                                       |
| **app/**                   | `website`            | 3000 | Next.js BFF + builder UI                                                        |
| **dev-supervisor/**        | Go binary            | —    | PID1, process lifecycle, HTTP proxy, JWT auth                                   |
| **local-control-plane/**   | Go binary            | 4100 | Local mgmt-airo API, SQLite + Docker                                            |
| **proxy/**                 | `airo-proxy`         | —    | Getty Images API proxy                                                          |
| **packages/shared/**       | `@airo/shared`       | —    | Shared types and pure utilities (grants, context-attachment, social, websocket) |
| **packages/ai-lib/**       | `@airo/ai-lib`       | —    | AI SDK wrapper, consumed by agents                                              |
| **packages/ai-transport/** | `@airo/ai-transport` | —    | Transport-agnostic shared code for WS + SSE servers (loop, processor, events)   |

Additional: `app-templates/` (v8 template), `packages/design-extractor/` (PDF RAG), `e2e/` (E2E tests), `debug-console/` (internal dev-team dashboard — review pragmatically, see [debug-console/CLAUDE.md](debug-console/CLAUDE.md))

See service-specific CLAUDE.md files: [agents/](agents/CLAUDE.md), [app/](app/CLAUDE.md), [dev-supervisor/](dev-supervisor/CLAUDE.md), [local-control-plane/](local-control-plane/CLAUDE.md), [go-agent/](go-agent/CLAUDE.md), [packages/ai-transport/](packages/ai-transport/CLAUDE.md), [debug-console/](debug-console/CLAUDE.md)

## Publish Flow Architecture

The publish flow spans agents service and publish container. **When modifying publish logic, check both locations.**

| Component        | Location                                     | Role                                                                                                                                               |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive Creation | `agents/src/utils/git.ts`                    | Creates tarball, validates dist/ for dist-only archives                                                                                            |
| Publish Route    | `agents/src/server/routes/publish.ts`        | API endpoint, orchestrates flow                                                                                                                    |
| Run Script       | `container-scripts/publish/run-app.sh`       | Entrypoint. Extracts archive, dispatches PaaS early, else routes to AAB bundle / build-and-run.sh                                                  |
| PaaS Runner      | `container-scripts/publish/paas-run.sh`      | PaaS-only. Trusts preview's node_modules, runs `$pm start` from `scripts.start`. Recovery: install + build if node_modules missing. No migrations. |
| AAB Build Script | `container-scripts/publish/build-and-run.sh` | AAB-only (legacy/fallback). Installs deps, builds, runs migrations, then auto-detects and serves a dist/ entry point                               |

**Dispatch order in `run-app.sh`:** suspended-site check → resolve `ARCHIVE_PATH` → `is_paas_flow` → `paas-run.sh` (PaaS, which then owns cleanup + extract) OR `process_archive` → AAB `dist/server.bundle.{mjs,cjs}` fast path → `build-and-run.sh` fallback (AAB). Once dispatched to `paas-run.sh`, the AAB path is never reached and vice versa.

**PaaS runtime contract:** customer defines `scripts.start` (and optionally `scripts.build`) in `package.json`. Preview container (long-running) runs install + build after zip/git import; the archive ships `node_modules` verbatim. `paas-run.sh` trusts that and execs `$pm start`. Customer apps read `process.env.PORT` directly.

**Archive-time dist validation:** `git.ts` validates that `dist/` exists when creating a dist-only archive (source not included). Full-source archives skip this check because the container rebuilds. There is no corresponding deploy-time dist check in `build-and-run.sh` — it relies on the serve step finding an entry point under `dist/`.

## V4 Directory Structure

Per-app workspace at `/tmp/airo-app-builder/{appId}/`. Host → container (Preview/Publish) mounts:

| Host              | Container                       | Purpose                                     |
| ----------------- | ------------------------------- | ------------------------------------------- |
| `preview/`        | `/app` (preview)                | Agent-generated workspace (never hand-edit) |
| `publish/`        | `/app` (publish)                | Publish workspace (never hand-edit)         |
| `git-repo/`       | `/app/.git` (preview only)      | Git repository                              |
| `assets/public/`  | `/shared-storage/public/assets` | Public persistent assets                    |
| `assets/private/` | `/private`                      | Private persistent assets                   |
| `dist/`           | `/dist`                         | Build archives                              |
| `alloc/`          | `/alloc`                        | `config.json` + secrets                     |

## Key Commands

```bash
corepack enable                          # Enforces pnpm version from packageManager
pnpm install && pnpm run dev             # TUI: agents:4000, app:3000, control-plane:4100
pnpm run dev:legacy                      # Without TUI: agents + app only
pnpm typecheck / lint / test / build     # build/typecheck/lint use Turborepo (cached)
```

**Test filtering (Vitest, not Jest):**

```bash
pnpm --filter @airo/agents test:unit "pattern"      # By file path
pnpm --filter @airo/agents test:unit -t "test name"  # By test name
pnpm --filter website test "pattern"                  # App package
# pnpm test at root runs all packages via Turborepo (excludes @airo/agents)
```

**Logs:**

- Customer-app container logs → **Grafana Loki**: https://grafana.monitoring.gd3p.tools/. Per-service links in [Airo Builder Logs (Confluence)](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/3975512110/Airo+Builder+Logs). LogQL example: `{job="airo-agents", env="prod"} |= "\"app_id\":\"<id>\""` — `app_id` is a JSON field (not a Loki label) and may be absent on system/pre-start lines.
- Builder frontend (Katana/FOS) logs → airobuilde ESSP cluster. Use `./scripts/essp-creds.sh dev|prod`; index pattern `.ds-logs-gdelastic.katana.<app-name>-<environment>-*`.

## Logging

Use `logger.info/warn/error("domain.operation.lifecycle", { data })`. Hierarchical event names, no emojis.

**camelCase for all fields** — `appId`, `customerId`, `jobId` (exception: DB columns and ES query fields may use snake_case). Note: dev-supervisor uses snake_case internally — see its CLAUDE.md.

```bash
LOG_LEVEL=debug|info|warn|error|fatal
LOG_DOMAINS=app,websocket          # Allowlist
LOG_DISABLED_DOMAINS=compression   # Blocklist
```

See `LOGGING-GUIDE.md` for complete documentation.

## Authentication

**Use the gd-auth library for ALL JWT validation.** Never write custom token validation, expiration checks, or JWT decoding. Sensitive operations wrap handlers in `withCustomerAuth(handler, { level: 3 })` for stricter HBI-based expiration. Expiration-window table and level-3 route list live in [app/CLAUDE.md](app/CLAUDE.md).

Config: `app/src/lib/gd-auth-service.ts`.

## Environment Config

Use `pnpm run dev` — preflight checks generate `.env` files automatically. Don't create them manually.

- Agents: `agents/.env.example`
- App: generated by Dev Runner preflight (no committed example)
- Key vars: `OPENAI_BASE_URL` (GoCode proxy endpoint), `OPENAI_API_KEY`, `LOG_LEVEL`
- **Grants/billing require `local:test`:** `pnpm run dev` uses the local control plane with stubbed endpoints that lack real grant/subscription data. Use `pnpm run local:test` for grant, budget, or billing work.

## Additional Documentation

- Architecture (archived): `ARCHITECTURE_DOCUMENTATION.md`
- WebSocket: `docs/client-websocket-architecture.md`
- OAuth: `docs/oauth-architecture.md`
- Testing: `app/TESTING.md`
- Logging: `LOGGING-GUIDE.md`
- Setup: `GETTING_STARTED.md`
- Mock auth: `app/MOCK-AUTH-SETUP.md`
- Documentation: browse `docs/` and read files relevant to your task

## i18n Validation

Translation keys are validated during pre-commit (blocks on missing keys). Fetch available keys: `GET https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-US/%40airo-app-builder%2Faab`. Create missing keys at https://i18n.int.gdcorp.tools/org/hcx/app/aab (PARTNERSTRANSLATIONS AD group). Details in `app/src/lib/translations/README.md`.

## E2E Test Maintenance

**When modifying UI components, always check if E2E tests reference affected `data-testid` attributes, selectors, or user flows.** E2E tests live in `tests/e2e/` (critical-path single-flow test) and `tests/regression/` (full per-feature suite) and run against the real app. If you add, rename, or remove a `data-testid`, change a component's DOM structure, or alter a user interaction flow (e.g., confirmation dialogs, navigation), update the corresponding E2E tests to match. Grep for the test ID in `tests/e2e/` and `tests/regression/` to find affected specs.

## PR Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes tested
- [ ] Backward compatibility verified
- [ ] **UI changes:** E2E tests in `tests/e2e/` and `tests/regression/` updated if `data-testid` or user flows changed
- [ ] **dev-supervisor only:** `make check` passes
