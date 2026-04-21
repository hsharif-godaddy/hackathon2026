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

| Service                  | Package        | Port | Notes                                                                           |
| ------------------------ | -------------- | ---- | ------------------------------------------------------------------------------- |
| **agents/**              | `@airo/agents` | 4000 | Express API, AI agents, SQLite, WebSocket                                       |
| **app/**                 | `website`      | 3000 | Next.js BFF + builder UI                                                        |
| **dev-supervisor/**      | Go binary      | —    | PID1, process lifecycle, HTTP proxy, JWT auth                                   |
| **local-control-plane/** | Go binary      | 4100 | Local mgmt-airo API, SQLite + Docker                                            |
| **proxy/**               | `airo-proxy`   | —    | Getty Images API proxy                                                          |
| **packages/shared/**     | `@airo/shared` | —    | Shared types and pure utilities (grants, context-attachment, social, websocket) |
| **packages/ai-lib/**     | `@airo/ai-lib` | —    | AI SDK wrapper, consumed by agents                                              |

Additional: `app-templates/` (v8 template), `packages/design-extractor/` (PDF RAG), `e2e/` (E2E tests)

See service-specific CLAUDE.md files: [agents/](agents/CLAUDE.md), [app/](app/CLAUDE.md), [dev-supervisor/](dev-supervisor/CLAUDE.md), [local-control-plane/](local-control-plane/CLAUDE.md), [go-agent/](go-agent/CLAUDE.md)

## Publish Flow Architecture

The publish flow spans agents service and publish container. **When modifying publish logic, check both locations.**

| Component        | Location                                     | Role                                                     |
| ---------------- | -------------------------------------------- | -------------------------------------------------------- |
| Archive Creation | `agents/src/utils/git.ts`                    | Creates tarball, validates dist/ for dist-only archives  |
| Publish Route    | `agents/src/server/routes/publish.ts`        | API endpoint, orchestrates flow                          |
| Run Script       | `container-scripts/publish/run-app.sh`       | Extracts archive, routes to build or direct run          |
| Build Script     | `container-scripts/publish/build-and-run.sh` | Installs deps, builds, validates dist/ for default serve |

**Cross-service validation:** Dist directory checks exist in both `git.ts` (archive time) and `build-and-run.sh` (deploy time). Changes to validation logic must be synchronized.

## V4 Directory Structure

```
/tmp/airo-app-builder/{appId}/
├── preview/    # Agent workspace (generated output) — DO NOT edit; fix generation logic in source
├── publish/    # Publish workspace (generated output) — DO NOT edit; fix generation logic in source
├── git-repo/   # .git directory (bind-mounted to both containers)
├── assets/     # Public/private assets (bind-mounted to both containers)
│   ├── public/ # Public persistent storage
│   └── private/ # Private persistent storage
├── dist/       # Distribution tarballs
└── alloc/      # Configuration and secrets (config.json)
```

### Container Mount Mapping

Host directories are bind-mounted into containers at different paths:

| Host Path (Local Dev) | Container Path (Preview/Publish) | Purpose                                  |
| --------------------- | -------------------------------- | ---------------------------------------- |
| `preview/`            | `/app`                           | Preview workspace                        |
| `publish/`            | `/app`                           | Publish workspace                        |
| `git-repo/`           | `/app/.git`                      | Git repository (mounted only in Preview) |
| `assets/public/`      | `/shared-storage/public/assets`  | Public persistent assets                 |
| `assets/private/`     | `/private`                       | Private persistent assets                |
| `dist/`               | `/dist`                          | Build archives                           |
| `alloc/`              | `/alloc`                         | Config/secrets                           |

**Key points:**

- Code generated by the agent lives in `preview/` (mounted to `/app` in container)
- Public uploads at `/shared-storage/public/assets/` in container map to `assets/public/` on host
- Private files at `/private/` in container map to `assets/private/` on host

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

**ESSP / Elasticsearch logs:**

```bash
./scripts/essp-creds.sh dev    # Profile: airobuild-dev-private-sso
./scripts/essp-creds.sh prod   # Profile: airobuild-prod-sso
# Index pattern: .ds-logs-gdelastic.katana.<app-name>-<environment>-*
```

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

**Use gd-auth library for ALL JWT validation.** Never write custom token validation, expiration checks, or JWT decoding. The library handles all auth types (basic, e2s, s2s, and 9 delegation chain variants) and enforces correct expiration rules.

Key rule: `useNewExpiration: true` (gd-auth 1.5.0+) is the default - it enforces IAT limits and correctly skips VAT validation for e2s tokens (which are not heartbeated).

**Expiration windows (useNewExpiration=true):**

| Token type                   | Level 1-2        | Level 3          |
| ---------------------------- | ---------------- | ---------------- |
| Persistent (`per=true`)      | IAT <= 30 days   | HBI <= 12 hours  |
| Non-persistent (`per=false`) | IAT <= 12 hours  | HBI <= 12 hours  |
| e2s (impersonation)          | 2 hours (no HBI) | 2 hours (no HBI) |

**Tiered auth levels:** Sensitive operations use `withCustomerAuth(handler, { level: 3 })` for stricter HBI-based expiration. Level 3 routes include: subscription renewal, auto-renew toggle, entitlement updates, app transfers, site deletion, deployments, secrets management, domain changes, unpublish, download, and database writes.

Config: `app/src/lib/gd-auth-service.ts`. Auth types list: `app/src/lib/features.ts` (`authUtils.getSupportedAuthTypes()`).

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

All translation keys are validated during pre-commit. The system:

- Fetches available keys from i18n API (no auth required)
- Validates all t(), FormattedMessage, and intl.formatMessage() calls
- Blocks commits if keys are missing

To fetch available translations (for LLM/agents):
GET https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-US/%40airo-app-builder%2Faab

To create missing keys, visit: https://i18n.int.gdcorp.tools/org/hcx/app/aab
(Requires PARTNERSTRANSLATIONS AD group membership)

See app/src/lib/translations/README.md for full details.

## E2E Test Maintenance

**When modifying UI components, always check if E2E tests reference affected `data-testid` attributes, selectors, or user flows.** E2E smoke tests live in `tests/smoke/` and run against the real app. If you add, rename, or remove a `data-testid`, change a component's DOM structure, or alter a user interaction flow (e.g., confirmation dialogs, navigation), update the corresponding E2E tests to match. Grep for the test ID in `tests/smoke/` to find affected specs.

## PR Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes tested
- [ ] Backward compatibility verified
- [ ] **UI changes:** E2E tests in `tests/smoke/` updated if `data-testid` or user flows changed
- [ ] **dev-supervisor only:** `make check` passes
