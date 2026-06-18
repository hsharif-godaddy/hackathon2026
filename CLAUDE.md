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
|----------------------------|----------------------|------|---------------------------------------------------------------------------------|
| **agents/**                | `@airo/agents`       | 4000 | Express API, AI agents, SQLite, WebSocket                                       |
| **app/**                   | `website`            | 3000 | Next.js BFF + builder UI                                                        |
| **dev-supervisor/**        | Go + Rust            | —    | PID1 (Rust), process lifecycle, HTTP proxy, JWT auth (Go)                       |
| **local-control-plane/**   | Go binary            | 4100 | Local mgmt-airo API, SQLite + Docker                                            |
| **budget-service/**        | Go binary            | 8080 | Standalone Postgres-backed REST API for cost to credit management               |
| **packages/shared/**       | `@airo/shared`       | —    | Shared types and pure utilities (grants, context-attachment, social, websocket) |
| **packages/ai-lib/**       | `@airo/ai-lib`       | —    | AI SDK wrapper, consumed by agents                                              |
| **packages/ai-transport/** | `@airo/ai-transport` | —    | Transport-agnostic shared code for WS + SSE servers (loop, processor, events)   |

Additional: `app-templates/` (v8 template), `packages/design-extractor/` (PDF RAG), `tests/` (Playwright E2E tests), `debug-console/` (internal dev-team dashboard — review pragmatically, see [debug-console/CLAUDE.md](debug-console/CLAUDE.md))

Supporting services (run independently of the core dev loop): `dev-runner/` (Go TUI that `pnpm run dev` builds and execs — orchestrates the local processes), `notification-service/` (Node), `stripe-service/` (Go, billing), `design-rag/` (Node, design RAG), `fanout/` (Node), `investigator/` (Node), `release-manager/` (Go, `pnpm run release`), `cdk/` (Node, infra), `blog/` (Node). The full workspace package list is in `pnpm-workspace.yaml`.

See service-specific CLAUDE.md files: [agents/](agents/CLAUDE.md), [app/](app/CLAUDE.md), [dev-supervisor/](dev-supervisor/CLAUDE.md), [local-control-plane/](local-control-plane/CLAUDE.md), [go-agent/](go-agent/CLAUDE.md), [packages/ai-transport/](packages/ai-transport/CLAUDE.md), [debug-console/](debug-console/CLAUDE.md), [budget-service/](budget-service/CLAUDE.md), [dev-runner/](dev-runner/CLAUDE.md), [notification-service/](notification-service/CLAUDE.md)

## Publish Flow & Container Architecture

See [container-scripts/CLAUDE.md](container-scripts/CLAUDE.md) for publish flow architecture, dispatch order, PaaS runtime contract, and V4 directory structure/mount table.

## Key Commands

```bash
corepack enable                          # Enforces pnpm version from packageManager
pnpm install && pnpm run dev             # TUI: agents:4000, app:3000, control-plane:4100
pnpm run dev:legacy                      # Without TUI: agents + app only
pnpm typecheck / lint / test / build     # build/typecheck/lint use Turborepo (cached)
```

**Updating dependencies:** `pnpm update --recursive` expands every `"foo": "catalog:"` reference in workspace package.json files to the resolved literal version, defeating the catalog's purpose as a single source of truth. For cataloged deps, edit the version in `pnpm-workspace.yaml` under `catalog:` and run `pnpm install` — the lockfile re-resolves and the `catalog:` references stay intact. Use `pnpm update` only for deps that are NOT in the catalog, and audit the resulting diff for unwanted `catalog:` → literal swaps before committing.

**Auditing dependencies:** `pnpm knip` reports unused deps/exports/files (config in `knip.jsonc`; `pnpm knip:fix` auto-removes — review the diff). Findings are candidates: gasket plugins and other string/convention-loaded code surface as false positives, so verify with a precise `from '<pkg>'` grep before removing, and add confirmed ones to `ignoreDependencies` with a comment.

**Supply-chain settings (`.npmrc`):** `minimum-release-age=10080` (7 days) quarantines newly published packages; `minimum-release-age-exclude=@airo/*,@airo-ux/*` bypasses quarantine for team-owned scopes only (broader GoDaddy scopes stay quarantined by design). `block-exotic-subdeps=true` rejects git:/tarball transitive specifiers. If a Dependabot PR or `pnpm install` blocks on `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, wait out the quarantine or — if genuinely urgent — add the specific package to `minimum-release-age-exclude`, not the whole scope.

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

`logger.info/warn/error("domain.operation.lifecycle", { data })`. camelCase fields (exception: DB columns, ES query fields, and dev-supervisor internals use snake_case). See `LOGGING-GUIDE.md` for env vars and full guide.

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
- Sandbox-parity runtime (optional Lima VM for kernel parity): `scripts/container-runtime/README.md`
- Solutions: `docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.
- Documentation: browse `docs/` and read files relevant to your task

## i18n Validation

Translation keys are validated during pre-commit (blocks on missing keys). Fetch available keys: `GET https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-US/%40airo-app-builder%2Faab`. Create missing keys at https://i18n.int.gdcorp.tools/org/airo-app-builder/app/aab (PARTNERSTRANSLATIONS AD group). Details in `app/src/lib/translations/README.md`.

## E2E Test Maintenance

**When modifying UI components, always check if E2E tests reference affected `data-testid` attributes, selectors, or user flows.** E2E tests live in `tests/e2e/` (legacy critical-path single-flow test), `tests/e2e-v2/` (split + parallel-safe successor — 4 spec files: `create-flow`, `develop-ui`, `chat-send`, `publish-and-domain`), and `tests/regression/` (full per-feature suite). All three run against the real app. If you add, rename, or remove a `data-testid`, change a component's DOM structure, or alter a user interaction flow (e.g., confirmation dialogs, navigation), update the corresponding E2E tests to match. **Migration overlap: until the legacy `tests/e2e/e2e.spec.ts` is removed, UI changes must be reflected in BOTH `tests/e2e/` AND the matching `tests/e2e-v2/*.spec.ts` file.** Grep for the test ID in `tests/e2e/`, `tests/e2e-v2/`, and `tests/regression/` to find affected specs.

## PR Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes tested
- [ ] Backward compatibility verified
- [ ] **UI changes:** E2E tests in `tests/e2e/`, `tests/e2e-v2/`, and `tests/regression/` updated if `data-testid` or user flows changed (during the e2e/e2e-v2 overlap, both must be kept in sync)
- [ ] **dev-supervisor only:** `make check` passes

## Code Conventions

`.cursor/rules/*.mdc` encode mandatory conventions (most are `alwaysApply: true`) that this repo enforces but aren't repeated here. Read the relevant rule before writing code in that area:

- **structured-logging** — `console.log` is prohibited; use the structured logger (see Logging above).
- **function-naming**, **import-naming**, **import-sorting** — naming/aliasing rules and import ordering.
- **no-single-use-variables**, **minimal-scope**, **comments** — inline single-use values, keep changes literal/minimal, prefer self-documenting code over comments.
- **line-trimming** — no trailing whitespace, no consecutive blank lines, no trailing blank lines at EOF.
- **async-over-sync** — prefer async APIs over synchronous (blocking) calls.
- **nodejs-core-modules** — always `node:` prefix for core modules.
- **dependency-validation** — every imported package must be declared in that package's `package.json`.
- **test-implementation**, **test-structure** — no placeholder tests; required test organization.
- **react** (`*.tsx`), **uxcore-tailwind** (`app/src/**`) — component architecture and UXCore Tailwind intent classes.

## Engineering Guidelines

@docs/gd-charter/systems/guidelines.md
