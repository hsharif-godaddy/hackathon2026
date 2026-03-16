# Airo Builder

AI-powered app development platform. Multi-service architecture with AI agents, real-time collaboration, and flexible deployment.

**CRITICAL: Always read existing code before modifying it. Verify refactors with `git diff` to ensure unchanged logic paths remain identical.**

## Deployment Topology

**Production:** One agent + preview + publish per app, deployed together as a Nomad job. The `app` (management UI) is a separate Katana deployment with hosted MySQL. Job allocation managed by [mhp-core](https://github.com/gdcorp-partners/mhp-core) control plane.

**Local dev:** Agent and app processes run on host. Preview and publish containers run in Docker via `docker-compose-generator.ts`.

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

| Service              | Package        | Port | Notes                                                                           |
| -------------------- | -------------- | ---- | ------------------------------------------------------------------------------- |
| **agents/**          | `@airo/agents` | 4000 | Express API, AI agents, SQLite, WebSocket                                       |
| **app/**             | `website`      | 3000 | Next.js BFF + builder UI, MySQL/Prisma                                          |
| **dev-supervisor/**  | Go binary      | —    | PID1, process lifecycle, HTTP proxy, JWT auth                                   |
| **proxy/**           | `airo-proxy`   | —    | Getty Images API proxy                                                          |
| **packages/shared/** | `@airo/shared` | —    | Shared types and pure utilities (grants, context-attachment, social, websocket) |
| **packages/ai-lib/** | `@airo/ai-lib` | —    | AI SDK wrapper, consumed by agents                                              |

Additional: `app-templates/` (v8 template), `packages/design-extractor/` (PDF RAG), `setup/` (config utility), `e2e/` (E2E tests)

See service-specific CLAUDE.md files: [agents/](agents/CLAUDE.md), [app/](app/CLAUDE.md), [dev-supervisor/](dev-supervisor/CLAUDE.md)

## V4 Directory Structure

```
/tmp/airo-app-builder/{appId}/
├── preview/    # Agent workspace (generated output) — DO NOT edit; fix generation logic in source
├── publish/    # Publish workspace (generated output) — DO NOT edit; fix generation logic in source
├── git-repo/   # .git directory (bind-mounted to both containers)
├── assets/     # Public/private assets (bind-mounted to both containers)
├── dist/       # Distribution tarballs
└── alloc/      # Configuration and secrets (config.json)
```

## Key Commands

```bash
corepack enable                          # Enforces pnpm 10.17.0
./setup.sh                               # Automated setup (or: pnpm --filter airo-setup start)
pnpm install && pnpm run dev             # agents:4000, app:3000
pnpm typecheck / lint / test / build     # build/typecheck/lint use Turborepo (cached)
```

**Test filtering (Vitest, not Jest):**

```bash
pnpm --filter @airo/agents test:unit "pattern"      # By file path
pnpm --filter @airo/agents test:unit -t "test name"  # By test name
pnpm --filter website test "pattern"                  # App package
# NEVER: pnpm test at root — causes OOM
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

Key rule: `use12HourExpiration: true` is required — it enforces IAT limits and correctly skips VAT validation for e2s tokens (which are not heartbeated).

Config: `app/src/lib/gd-auth-service.ts`. Auth types list: `app/src/lib/features.ts` (`authUtils.getSupportedAuthTypes()`).

## Environment Config

Use `./setup.sh` — don't create `.env` files manually.

- Agents: `agents/.env.example`
- App: `app/.env.example`
- Key vars: `OPENAI_API_KEY`, `OPENAI_MODEL`, `DATABASE_URL`, `LOG_LEVEL`

## Additional Documentation

- Architecture: `ARCHITECTURE_DOCUMENTATION.md`
- WebSocket: `docs/client-websocket-architecture.md`
- OAuth: `docs/oauth-architecture.md`
- Deployment: `app/DEPLOYMENT-ADAPTER-SYSTEM.md`
- Testing: `app/TESTING.md`
- Logging: `LOGGING-GUIDE.md`
- Setup: `GETTING_STARTED.md`
- Mock auth: `app/MOCK-AUTH-SETUP.md`

## PR Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] Changes tested
- [ ] Backward compatibility verified
- [ ] **dev-supervisor only:** `make check` passes
