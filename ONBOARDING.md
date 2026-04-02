# Airo Builder Onboarding Guide

Airo Builder is GoDaddy's AI-powered app development platform. Users
describe what they want in a chat interface, AI agents generate the
code, and the platform deploys it to preview and production
environments. It serves two products from one codebase:
**AiroAppBuilder** (full-stack with a web UI) and **PaaS** (headless
API for external UIs).

---

## User Experience

A customer logs in via GoDaddy SSO, creates a new app, and lands in
the builder UI. The left pane is a chat with AI agents. The right
pane shows a live preview of the generated app.

The typical flow:

1. User types a prompt ("build me a restaurant website")
2. `InitialAgent` scaffolds the app from a template
3. `DevelopAgent` takes over for iterative changes
4. User sees live preview update after each agent response
5. User clicks Publish to deploy the app to production

PaaS users skip the UI entirely -- they call the agents API directly
with their own auth tokens and repo URLs.

---

## How Is It Organized?

### System Architecture

```
             Browser (builder UI)
            /                     \
  HTTPS (Gasket :8443)    WebSocket (Socket.IO :4000)
          /                         \
+------------------+         +------------------+
|  app/ (Next.js)  |         | agents/ (Express)|
|  BFF + UI :3000  |         | AI agents :4000  |
+------------------+         | SQLite, WS       |
                             +--------+---------+
                                 |         |
                                 |         |  HTTP
                                 |         v
                                 |  +----------------+
                                 |  | GoCode (LLM)   |
                                 |  | OpenAI-compat   |
                                 |  +----------------+
                                 |
                                 |  Docker bind-mount
                                 v
                             +------------------+
                             | Preview/Publish  |
                             | containers       |
                             +------------------+
                                      |
                                      v
                               +-------------+
                               | MySQL :3306 |
                               | (per-app DB)|
                               +-------------+
```

Browser connects to `app/` for BFF API calls (auth, paywall,
site management) and directly to `agents/` for chat via WebSocket.
Agent auth uses a Bearer JWT from `POST /api/auth/agent-token`.

**Production:** Each app runs as a Nomad job containing agent +
preview + publish containers. The `app/` (management UI) is a
separate Katana deployment. Job allocation is managed by
[mhp-core](https://github.com/gdcorp-partners/mhp-core) (the
control plane, called mgmt-airo).

**Local dev:** Agent and app processes run on your host. Preview
and publish containers run in Docker, managed by the
`local-control-plane` Go service which provides a local
mgmt-airo-compatible API backed by SQLite.

### Services

| Service                | Port | What it does                                  |
| ---------------------- | ---- | --------------------------------------------- |
| `app/`                 | 3000 | Next.js BFF + builder UI (Gasket framework)   |
| `agents/`              | 4000 | Express API, AI agents, SQLite, WebSocket     |
| `local-control-plane/` | 4100 | Local mgmt-airo API (Go, SQLite, Docker)      |
| `dev-supervisor/`      | --   | PID1, process lifecycle, HTTP proxy, JWT auth |
| `proxy/`               | --   | Getty Images API proxy                        |

### Directory Structure

```
airo-app-builder/
  agents/                # Express API + AI agents
  app/                   # Next.js builder UI + BFF
  app-templates/         # v8 app scaffold template
  budget-service/        # Go budget microservice
  dev-supervisor/        # Go PID1 process manager
  local-control-plane/   # Go local mgmt-airo API
  proxy/                 # Getty Images proxy
  packages/
    shared/              # Types shared across services
    ai-lib/              # AI SDK wrapper (Vercel AI)
    ai-grants/           # Grant/budget session mgmt
    ai-transport/        # WebSocket server base class
    ai-common/           # Errors, metadata, logging
    ai-skills/           # Skill plugin system
    design-extractor/    # PDF RAG extraction
  e2e/                   # Playwright E2E tests
  tests/                 # Smoke tests
  docs/                  # Architecture + feature docs
  setup/                 # Interactive setup wizard
  scripts/               # CI/CD and utility scripts
```

### Monorepo Structure

Turborepo + pnpm workspaces. Packages use `@airo/` scope.
Build order is dependency-aware via `turbo.json`.

| Package              | Consumers      | Purpose                             |
| -------------------- | -------------- | ----------------------------------- |
| `@airo/shared`       | agents, app    | Types, grant logic, websocket types |
| `@airo/ai-lib`       | agents         | AI SDK wrapper, agent factory       |
| `@airo/ai-grants`    | agents         | Grant session management            |
| `@airo/ai-transport` | agents         | WebSocket server base class         |
| `@airo/ai-common`    | ai-lib, agents | Errors, metadata, llm context       |
| `@airo/ai-skills`    | agents         | Skill plugin system                 |

### External Dependencies

| Dependency            | Purpose                         | Config                              |
| --------------------- | ------------------------------- | ----------------------------------- |
| GoCode                | LLM proxy (OpenAI-compatible)   | `OPENAI_BASE_URL`, `OPENAI_API_KEY` |
| MySQL                 | Per-app databases               | Docker, port 3306                   |
| AWS (Secrets Manager) | Getty token, deployment secrets | AWS SSO (auto-resolved at startup)  |
| mgmt-airo             | Control plane (prod)            | `MGMT_AIRO_BASE_URL`                |
| GoDaddy SSO           | Authentication                  | `SSO_LOGIN_URL`                     |
| Switchboard           | Feature flags                   | Gasket plugin                       |
| Getty Images          | Stock photo search              | Proxied through `proxy/`            |

---

## Key Concepts and Abstractions

| Concept                | What it means in this codebase                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Agent                  | AI persona that generates code. `InitialAgent` scaffolds, `DevelopAgent` iterates, `MarketingAgent` handles SEO. See `agents/src/agents/` |
| Skill                  | Dynamic tool set activated per conversation. 16 skills (commerce, database, social, etc.) in `agents/src/skills/`                         |
| BFF                    | Backend-for-frontend. `app/src/app/api/` routes handle auth, paywall, data transform -- not a simple proxy                                |
| Gasket                 | GoDaddy's plugin framework wrapping Next.js. Handles HTTPS proxy, auth, i18n, switchboard. Config in `app/gasket.ts`                      |
| Grant                  | A credit allocation with expiration. Grants fund LLM calls. Managed by `GrantSessionManager` in `packages/ai-grants/`                     |
| Budget Service         | Planned replacement for grants. Go microservice in `budget-service/` for session-based spend tracking with reconciliation                 |
| Dual-product pattern   | AAB (full-stack with UI) vs PaaS (headless API). Check for `options.token && options.repoUrl` to distinguish                              |
| `processedContext`     | Runtime context passed to agents. Rebuilt on each handoff -- do not store persistent state here                                           |
| `conversation.context` | Persistent context surviving agent handoffs within a prompt                                                                               |
| Handoff                | One agent delegating to another mid-prompt. `DevelopAgent` -> `MarketingAgent` for SEO work                                               |
| `llmMetadataContext`   | AsyncLocalStorage carrying per-call metadata (grant info) through the LLM call chain                                                      |
| Site vs App            | An app is the agent workspace. A site is the published deployment. One app can have multiple sites                                        |
| `dev-supervisor`       | Go binary that runs as PID1 in production containers. Manages process lifecycle, proxies HTTP, validates JWTs                             |

---

## Primary Flows

### Chat Message (AAB)

The core flow when a user sends a message in the builder:

```
Browser
  |
  |  WebSocket (Socket.IO)
  v
app/src/hooks/useStreamingWebSocket.ts
  authenticates, sends 'chat_message' event
  |
  v
agents/src/server/ai-lib-websocket-server.ts
  validates tenant, routes to agent
  |
  v
packages/ai-transport/src/experimental-websocket-server.ts
  handleChatMessageInternal()
  |
  v
packages/ai-lib/src/core/agent-factory.ts
  _executeStreamGenerate()
  builds prompt, calls LLM
  |
  v
GoCode (LLM proxy)
  returns streaming response
  |
  v
Agent writes files to preview/
  |
  v
Preview container serves updated app
  |
  v
Browser iframe refreshes
```

### BFF API Call (Site Management)

1. Browser calls `POST /api/sites/[id]/deploy`
2. `withCustomerAuth()` validates GoDaddy SSO JWT
3. Route handler calls `V2ControlPlaneAdapter`
4. Adapter routes to mgmt-airo (prod) or
   local-control-plane (local dev)
5. Control plane triggers Nomad job update
6. Response returned to browser

### PaaS API Call

1. External client calls agents API directly with
   JWT in Authorization header, repo credentials
   (`token`, `repoUrl`) in the request body
2. Agent checks `options.token && options.repoUrl`
   to detect PaaS mode
3. Uses request-supplied repo values instead of
   database lookups
4. No BFF involved

---

## Developer Guide

### Setup

Prerequisites: Node.js 22.16+, pnpm (via Corepack), Go, Docker,
AWS account access (`GD-AWS-USA-GD-AiroBuilde-Dev-Private`).

```bash
git clone <repository-url>
cd airo-app-builder
./setup.sh
```

The setup wizard configures AI provider (GoCode), auth (JWT/SSO),
Getty Images proxy, MySQL container, and generates all `.env` files.
See [`GETTING_STARTED.md`](GETTING_STARTED.md) for the full guide.

After setup:

```bash
aws sso login --profile airobuild-dev-private-sso    # once per day
pnpm run dev     # starts agents + app + control plane
```

Access the builder at `https://local.gasket.dev-godaddy.com:8443`.

### Running and Testing

```bash
pnpm run dev              # TUI with all 3 services
pnpm run dev:legacy       # agents + app only (no TUI)
pnpm typecheck            # Turborepo-cached typecheck
pnpm lint                 # Turborepo-cached lint
pnpm test                 # all package tests
```

Test filtering (Vitest for agents/app/packages; Jest for proxy/cdk):

```bash
pnpm --filter @airo/agents test:unit "pattern"
pnpm --filter @airo/agents test:unit -t "name"
pnpm --filter website test "pattern"
```

### Common Change Patterns

**Add a new agent tool:** Create in `agents/src/tools/`, register
in `agents/src/tools/ai-lib-tools/index.ts` (`allAILibTools`),
add to the agent's tool list in its config.

**Add a new BFF route:** Create route handler in
`app/src/app/api/<path>/route.ts`. Wrap with
`withCustomerAuth()` for protected routes. Use `{ level: 3 }`
for sensitive operations.

**Add a new agent:** Create in `agents/src/agents/`, register in
`agents/src/agents/ai-lib-agents/index.ts`. Define system prompt
fragments in `agents/src/prompts/<agent-name>/`.

**Add a shared type:** Add to `packages/shared/src/<domain>/`.
Update the package's `exports` map in `package.json`. Run
`pnpm --filter @airo/shared build` before consumers can use it.

**Add a new skill:** Create in `agents/src/skills/<name>/`. See
`agents/src/skills/README.md` for the skill plugin API.

### Key Files to Start With

| Area                | File                                                         | Why                                      |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Agent orchestration | `agents/src/server/ai-lib-websocket-server.ts`               | WS setup, auth, agent routing            |
| Agent execution     | `packages/ai-lib/src/core/agent-factory.ts`                  | LLM calls, streaming, handoffs           |
| WS base class       | `packages/ai-transport/src/experimental-websocket-server.ts` | Message handling, conversation lifecycle |
| BFF auth            | `app/src/lib/customer-auth.ts`                               | `withCustomerAuth()` middleware          |
| Feature flags       | `app/src/hooks/useSwitchboard.ts`                            | Client-side Switchboard hook             |
| Grant system        | `packages/ai-grants/src/grant-session-manager.ts`            | Credit tracking per session              |
| GoCode wrapper      | `packages/ai-lib/src/providers/unified-provider.ts`          | LLM request injection                    |

### Practical Tips

- `agents/dev.log`, `app/dev.log`, and `local-control-plane/dev.log`
  capture service stdout/stderr during local dev. Check these first
  when debugging.
- The `app/` service uses Gasket, not vanilla Next.js. HTTPS
  proxy, auth, and i18n work differently. Read
  [`app/CLAUDE.md`](app/CLAUDE.md) before touching app code.
- `experimental-websocket-server.ts` is ~3000 lines. Most agent
  behavior is wired through callbacks (`contextProvider`,
  `messageProvider`, `agentRouter`), not inline in this file.
- Translation keys are validated at pre-commit. Missing keys
  block commits. Add keys at
  [i18n.int.gdcorp.tools](https://i18n.int.gdcorp.tools/org/hcx/app/airo-app-builder).
- The codebase serves two products (AAB + PaaS). When adding
  features, check if they need product-gating using the
  dual-product pattern in [`CLAUDE.md`](CLAUDE.md).
