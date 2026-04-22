# Architecture Proposal: Agent per Customer

## Context

The current Airo App Builder deploys one agent instance per app (`airo-{appId}` Nomad job containing agent + preview + publish tasks). This works well for isolated app development but becomes problematic as the product expands beyond single-app building - customers need a persistent AI assistant that follows them across apps, can share context between projects, and handles non-app-building tasks (marketing, analytics, general Q&A).

PR #2517 explored three infrastructure options. Team consensus landed on **Option 2: Agent per Customer** - one agent deployment serves all of a customer's apps. This document proposes the architecture for that change.

## Goals

- One agent instance per customer, serving all their apps
- Instant app switching (no WebSocket reconnection)
- Cross-app context awareness (agent knows about all customer's apps)
- Non-app workspace for customer-level documents/code
- Preview containers on-demand; publish containers persist after first publish
- In-place migration from current per-app model
- Secrets architecture acknowledged as needing separate design

## Current Architecture (V4 Unified Job)

```
Nomad Job: airo-{appId}
  Task Group: airo-onegroup (shared NOMAD_ALLOC_DIR)
    pre-start  -> filesystem init, S3 secret download
    agent      -> port 80, Unix socket IPC to preview/publish
    preview    -> port 20000, dev-supervisor, start-on-request
    publish    -> port 20001, dev-supervisor

  Storage: /ceph-storage/{appId}/
    agent/     preview/     publish/     git-repo/
    assets/    dist/        npm-cache/

  Routing (v2-ingress-proxy, via Nomad service discovery + Traefik-style tags):
    {appId}.agent.{cell}.{domain}   -> agent:80
    {appId}.preview.{cell}.{domain} -> preview:20000
    {appId}.{cell}.{domain}         -> publish:20001

  Cilium Network Policy (airo-networkpolicy.yaml.j2):
    Selector: netreap:nomad.namespace=sites, netreap:nomad.task_group_id=airo-onegroup
    Ingress: configured CIDRs -> ports 80, 20000, 20001
    Egress: public IPs, database CIDRs (3306, 5432)

  IPC: Unix domain sockets in ${NOMAD_ALLOC_DIR}/tmp/
    {appId}-preview-supervisor.sock
    {appId}-publish-supervisor.sock
```

Key coupling: agent + preview + publish share one Nomad allocation. Agent reads `/alloc/config.json` (memoized singleton). JWT `siteId` claim equals `appId`. All middleware validates `siteId === appId`.

## Proposed Architecture

### Job Topology

```
Nomad Job: airo-agent-{agentId}             (1 per customer, pre-provisionable)
  Task Group: agent
    pre-start  -> agent-level init, customer secret download
    agent      -> port 80, TCP IPC to app containers

  Storage:
    /ceph-storage/agent-{agentId}/       (agent SQLite DB, customer workspace)

  Routing (v2-ingress-proxy):
    {agentId}.agent.{cell}.{domain}      -> agent:80

Nomad Job: airo-app-{appId}                 (N per customer, on-demand)
  Task Group: app
    pre-start  -> app-level init, app secret download
    preview    -> port 20000, dev-supervisor, start-on-request + idle timeout
    publish    -> port 20001, dev-supervisor, starts on first publish

  Storage:
    /ceph-storage/{appId}/               (unchanged per-app layout)

  Routing (v2-ingress-proxy):
    {appId}.preview.{cell}.{domain}      -> preview:20000
    {appId}.{cell}.{domain}              -> publish:20001
```

### IPC: Unix Sockets -> TCP

V4 uses Unix domain sockets via shared `NOMAD_ALLOC_DIR`. With agent and app containers in separate Nomad jobs, they no longer share an allocation.

Switch to TCP-based IPC. This is already supported - local dev uses TCP (`tcp://localhost:9000`). `DevSupervisorClientFactory` resolves `app.socketPath` which can be either Unix socket path or TCP URL. App containers register their TCP address with the agent via `POST /apps/register` on startup.

Agent environment changes:

```
# Remove (no longer in same allocation):
- AIRO_SUPERVISOR_PREVIEW_SOCKET_PATH
- AIRO_SUPERVISOR_PUBLISH_SOCKET_PATH

# Agent discovers app container addresses dynamically via:
# 1. App container POST /apps/register with TCP address on startup
# 2. Agent stores in apps.socketPath / apps.publishSupervisorPath (existing DB fields)
```

### File Access: Direct Ceph -> Dev-Supervisor API

Currently the agent reads app files directly from Ceph mounts (e.g., `AppContextManager` reads directory trees, package.json). With separate jobs, the agent no longer mounts app Ceph paths.

All file operations route through dev-supervisor API. This aligns with the existing direction - file-edit, terminal-command, and other tools already use dev-supervisor. `AppContextManager` is the main consumer that needs refactoring to use dev-supervisor instead of direct `fs` reads.

Benefits:

- Agent doesn't need N Ceph mounts (one per app)
- No Ceph path restructuring needed
- Consistent access pattern for all file operations
- Path translation handled by dev-supervisor (already implemented)

Trade-off:

- Slightly higher latency for context building (network hop vs local fs)
- Requires app container to be running for context (preview start-on-request handles this)

### Non-App Workspace

Agent mounts `/ceph-storage/agent-{agentId}/` which serves as:

- Agent SQLite database storage
- Customer-level workspace for documents, notes, shared code not tied to any app
- Cross-app assets or templates the customer wants to reuse

This workspace is accessible without any app container running - the agent can read/write directly.

### Authentication & Authorization

**JWT changes:**

```
Current:  { siteId: appId, ... }           (1:1 agent:app)
Proposed: { customerId: "cust123", ... }    (1:M customer:apps)
```

The BFF issues tokens scoped to `customerId` instead of `appId`. The agent validates customer identity, then validates app ownership per-request.

**Middleware changes:**

Current (`app-ownership.ts`):

```
authenticatedSiteId === requestedAppId    // O(1) comparison
```

Proposed:

```
app = appRepo.findById(requestedAppId)
app.customerId === jwt.customerId         // DB lookup + comparison
```

Affects: `validateAppOwnership`, `validateAppOwnershipFromBody`, `validateAppOwnershipFromQuery`, `validateConversationOwnership` in `agents/src/server/middleware/app-ownership.ts`. Note: `validateConversationOwnership` (line 336) currently checks `conversation.appId !== authenticatedSiteId` - this also needs the customer-based lookup pattern (verify conversation's app belongs to the authenticated customer).

**`BYPASS_SITE_IDS` migration:** Currently 5 bypass IDs (`bypass-site`, `default-site`, `local-dev-site`, `mock-site-id`, `unknown-site`) skip the `siteId === appId` check for local dev. Under customer-based auth, these need equivalent behavior - likely a `BYPASS_CUSTOMER_IDS` set that skips the `app.customerId === jwt.customerId` check. Used in `app-ownership.ts` and referenced in 6+ files.

**Cross-cutting siteId references:** The `agentContext.siteId` field is referenced in 16+ files across the agent codebase. The migration from `siteId` to `customerId` as primary identity touches: middleware, WebSocket server, context providers, budget checks, observability, and route handlers. Each callsite needs audit during implementation.

WebSocket security (`ai-lib-websocket-server.ts`): connection validates `customerId` from JWT. Per-message validation checks `appId` belongs to that customer.

### Agent Context & AgentContext Type

```typescript
// agents/src/server/middleware/jwt-auth.ts
interface AgentContext {
  customerId: string; // NEW - replaces siteId for identity
  siteId?: string; // DEPRECATED - keep for migration compatibility
  // ... existing fields unchanged
}
```

```typescript
// agents/src/agents/ai-lib-agents/types.ts
interface EnhancedAgentContext {
  metadata?: {
    customerId?: string; // NEW - customer identity
    appId?: string; // Still here - the app being worked on NOW
    // ... rest unchanged
  };
}
```

### Environment Variable Locks (Must Remove)

The current agent enforces single-app-per-instance via environment variable checks:

- `AppRepository.ts:110` - throws if `process.env.SITE_ID` is set and doesn't match incoming `siteId`
- `AppRepository.ts:122` - throws if `process.env.CUSTOMER_APP_DIR` is set and doesn't match app path

These are the primary coupling between agent process and single app. Must be removed for multi-app support. The agent job template should no longer set `SITE_ID` or `CUSTOMER_APP_DIR` as environment variables. App identity comes from request context, not process environment.

### Database Changes

**No schema migration needed for core tables.** The `apps` table already has `customerId` field. Conversations, messages, and all child tables are already keyed by `appId` via foreign keys.

New methods needed:

- `AppRepository.findByCustomerId(customerId: string): App[]`
- `ConversationRepository.getByCustomerId(customerId: string): Conversation[]` (join via `conversations.appId -> apps.id WHERE apps.customerId = ?`)

**SQLite concurrency:** Current single-app model means serialized writes are invisible. With N apps on one agent, concurrent conversations writing to `conversation_messages` will contend on SQLite's write lock. WAL mode should be verified as enabled, and concurrent write throughput benchmarked under multi-app load.

The `getNomadAllocConfig()` memoized singleton in `agents/src/utils/nomad-config.ts` stays as-is for customer-level config. Per-app secrets are a separate design concern (see Secrets section).

### WebSocket Protocol

**App switching without reconnection:**

Current: client disconnects WebSocket, reconnects to different agent URL (~4.5s).

Proposed: client sends app-switch event on existing socket:

```
Client -> Server: { type: "switch_app", appId: "newAppId" }
Server validates: app.customerId === jwt.customerId
Server updates: active app context for this socket
Server -> Client: { type: "app_switched", appId: "newAppId", conversations: [...] }
```

The frontend store (`useStreamingConversationStore`) already maintains `appChatHistory[appId]` - this pattern supports multi-app naturally.

**Error recovery:** If the target app's preview container fails to start (start-on-request timeout), the server responds with an error event. The client can retry or fall back to non-app mode. The agent should not block on container startup - it can respond to non-tool-calling messages while the container starts in the background.

**Active app scoping:** Each socket maintains one active `appId`. In-memory agent state (active agent type, skill activations, conversation context) is scoped to the active app. On `switch_app`, the agent saves current state and loads the target app's state. Concurrent multi-app operations on a single socket are not supported.

**Non-app mode:** Client can connect without specifying an appId. Agent operates in customer workspace mode. Tools requiring dev-supervisor (file-edit, terminal-command, read-file, etc.) are unavailable. Available tools: conversation, planning, knowledge queries, customer workspace file operations. The tool registry filters based on whether an active app is set.

### BFF Changes

**Agent URL discovery:**

Current: deterministic `{appId}.agent.{cell}.{domain}` - no lookup needed (appId known from app record).

Proposed: BFF resolves customer's agent URL via control plane. The agent job uses a pre-generated `agentId` (not `customerId`) to support pre-provisioning, so the URL is `{agentId}.agent.{cell}.{domain}`. Options:

1. Control plane lookup: `GET /api/airo/v1/customers/{customerId}/agent` returns agent URL (includes agentId)
2. Store on customer/app record: customer record or app creation response includes agent URL
3. Deterministic: only possible if agentId === customerId, which sacrifices pre-provisioning

Option 1 or 2 - control plane already knows the customer-to-agent mapping from assignment.

**Token generation** (`app/src/app/api/auth/agent-token/route.ts`):

- Issue tokens with `customerId` claim instead of `siteId`
- `customerId` sourced from existing BFF auth session

### Secrets (Future Design Required)

The agent reads `/alloc/config.json` via `getNomadAllocConfig()` for:

- **Customer-level:** `GODADDY_OAUTH_CLIENT_ID`, `GODADDY_OAUTH_CLIENT_SECRET`, `GODADDY_OAUTH_ENCRYPTION_KEY`, `CAPABILITIES`
- **Per-app:** `GITHUB_TOKEN`, `JWT_REDIRECT_URL`

Customer-level secrets work as-is in the agent's own allocation. Per-app secrets (`GITHUB_TOKEN` etc.) that the agent reads directly break the memoized singleton pattern when serving multiple apps.

App container secrets (Stripe keys, DB creds) remain in each app's own allocation - no change needed. The agent accesses these indirectly via dev-supervisor when required.

**This needs a separate design.** Options include moving per-app agent secrets to encrypted SQLite storage, per-app config file mounts, or a control plane API. The `token-crypto.ts` encryption infrastructure and `oauth_tokens` DB table provide existing patterns to build on.

### Routing & Network Policy

**Routing (v2-ingress-proxy):** The proxy discovers services via Nomad service discovery and parses Traefik-style tags from Nomad service instances for Host-based routing. No proxy code changes needed for new routing patterns - just update the service tags in Nomad job templates.

**Agent service:**

```
# Current (tag on airo-{appId} job, agent task)
traefik.http.routers.airo-{appId}-agent.rule=Host(`{appId}.agent.{cell}.{domain}`)

# Proposed (tag on airo-agent-{agentId} job, agent task)
traefik.http.routers.airo-agent-{agentId}.rule=Host(`{agentId}.agent.{cell}.{domain}`)
```

**App services (unchanged tag pattern):**

```
traefik.http.routers.airo-{appId}-preview.rule=Host(`{appId}.preview.{cell}.{domain}`)
traefik.http.routers.airo-{appId}-publish.rule=Host(`{appId}.{cell}.{domain}`)
```

**Cilium Network Policy:** Currently a single policy (`airo-networkpolicy.yaml.j2` in pioneer-infra) selects all tasks in the unified job via `netreap:nomad.task_group_id: airo-onegroup`. With separate jobs, this splits into distinct policies:

```yaml
# 1. Agent policy (new)
# Selector: netreap:nomad.namespace=sites, netreap:nomad.task_group_id=airo-agent
# Ingress: configured CIDRs -> port 80
# Egress: public IPs, database CIDRs
# Egress: TO app endpoints (TCP for dev-supervisor IPC) <-- NEW cross-job rule

# 2. App policy (new)
# Selector: netreap:nomad.namespace=sites, netreap:nomad.task_group_id=airo-app
# Ingress: configured CIDRs -> ports 20000, 20001
# Ingress: FROM agent endpoints (TCP for dev-supervisor IPC) <-- NEW cross-job rule
# Egress: public IPs, database CIDRs

# 3. Cross-job communication (critical - does not exist today)
# Agent -> App: TCP connection for dev-supervisor API calls
# App -> Agent: TCP connection for POST /apps/register callback
# Must use fromEndpoints/toEndpoints with Cilium label matching
```

The cross-job Cilium policy is new infrastructure. The current unified job doesn't need it because all tasks share one Cilium endpoint. SELinux policies for Unix socket access (`airo_agent_container.cil` in pioneer-infra) no longer apply since IPC moves to TCP.

**Files to modify:**

- `pioneer-infra/ansible/roles/network-policy/templates/airo-networkpolicy.yaml.j2` - Split into agent + app policies, add cross-job rules
- `pioneer-infra/ansible/roles/selinux/templates/containers-udica-policies/nomad-client-onegroup/` - Remove Unix socket policies (or leave for backward compat during migration)

### Control Plane Orchestration (mhp-core)

The control plane needs new logic for managing the agent-to-app job relationship:

- **First app creation for a customer:** Assign pre-provisioned `airo-agent-{agentId}` job to customer, then assign pre-provisioned `airo-app-{appId}` job. Both from warm pools. Store customer-to-agentId mapping.
- **Subsequent app creation:** Assign only `airo-app-{appId}` from warm pool. Agent job already assigned to customer.
- **App deletion:** Remove `airo-app-{appId}` job. Agent job stays.
- **Last app deletion / customer churn:** Tear down `airo-agent-{agentId}` job when customer has no remaining apps (or after grace period). Remove customer-to-agentId mapping.
- **Agent updates:** Rolling update of `airo-agent-{agentId}` job independently of app jobs. App containers reconnect via TCP after agent restart.

`V2ControlPlaneAdapter` currently creates one unified job. Needs refactoring to orchestrate two job types.

### On-Demand App Container Lifecycle

- **Preview:** Start on first request (existing `DEV_SUPERVISOR_ENABLE_START_ON_REQUEST`), idle timeout after 30m (existing `DEV_SUPERVISOR_IDLE_TIMEOUT`). Can extend to entire Nomad job lifecycle - job scaled to 0 when idle, scaled to 1 on request.
- **Publish:** Job created on first publish. Stays running. Supports `SUSPENDED` flag for billing/abuse cases.
- **Agent triggers app start:** When user switches to an app and its containers aren't running, agent requests control plane to start the app job. User sees a brief loading state.

### Pre-Provisioning Compatibility

The current system pre-provisions full `airo-{appId}` unified jobs (agent + preview + publish) into a warm pool managed by mhp-core. State machine: `preprov_pending` -> `preprov_available` -> `preprov_assigned` -> `system`. When a customer creates an app, a pre-provisioned job is assigned from the pool (~3s) instead of cold-creating (~30-60s). Inventory management with automatic replenishment keeps the pool stocked. Drift protection prevents race conditions during concurrent assignment/reload operations.

With the split into separate agent and app jobs, pre-provisioning splits into two warm pools. This is why agent jobs use a pre-generated `agentId` rather than `customerId` - the job must exist before any customer is assigned to it, just like today's `airo-{appId}` jobs exist before any customer owns them.

**Two warm pools:**

| Pool       | Job pattern            | Contents                                      | Assignment trigger            |
| ---------- | ---------------------- | --------------------------------------------- | ----------------------------- |
| Agent pool | `airo-agent-{agentId}` | Agent task only (Node.js, SQLite, Ceph mount) | Customer's first app creation |
| App pool   | `airo-app-{appId}`     | Preview + publish tasks (no agent)            | Every app creation            |

Both pools use the existing mhp-core pre-provisioning infrastructure: `hosting_preprov_inventory` targets, `ScaleInventory()`, replenishment CLI, drift protection. Each pool has its own composition (agent-only vs app-only) but the framework is composition-agnostic.

**Agent pool (`airo-agent-{agentId}`):**

- Pre-provisioned with a generated `agentId` - no customer identity yet
- Generic agent container: Node.js process, empty SQLite DB, Ceph mount at `/ceph-storage/agent-{agentId}/`
- Routing tag baked in: `{agentId}.agent.{cell}.{domain}`
- On assignment: control plane links `system_id` to customer, stores `customerId -> agentId` mapping
- Agent receives customer identity via JWT on first connection (not via env vars or config)
- Smaller resource footprint than today's unified job (no preview/publish tasks)

**App pool (`airo-app-{appId}`):**

- Same as today minus the agent task
- Pre-provisioned with generated `appId`, preview + publish tasks
- Simpler and lighter than current unified jobs
- Assignment flow unchanged: link `system_id`, set `provision_type = preprov_assigned`

**First app creation:**

```
Current:    assign 1 pre-prov unified job                        ~3s
Proposed:   assign 1 pre-prov agent job + 1 pre-prov app job     ~3s (both from warm pools)
```

No cold start regression. Both jobs come from warm pools. The control plane assigns two jobs instead of one, but both are already running.

**Second+ app creation:**

```
Current:    assign 1 pre-prov unified job    ~3s
Proposed:   assign 1 pre-prov app job        ~3s (agent already assigned)
```

Faster than today - only one job to assign instead of a full unified job.

**Inventory considerations:**

- Agent pool targets will be lower than app pool targets (one agent per customer vs N apps per customer)
- Agent pool replenishment is cheaper (lighter containers)
- Existing health checks (`HealthCheckAppUrlsTask`, `BulkAppHealthCheckTask`) work for both pools
- `hosting_preprov_inventory` table already supports multiple compositions per cell

**Canary apps:** Canary provisioning (`provision_type = canary`) with pinned infrastructure (cell, database, filesystem) works for both agent and app jobs independently.

### Migration Strategy

The migration replaces every running `airo-{appId}` unified job with an `airo-agent-{agentId}` job + `airo-app-{appId}` job pair. This is a topology change, not a code-only deploy, so it requires coordination between agent code, mhp-core control plane, and infrastructure (Cilium, routing).

**Feasibility assessment:** The migration is feasible because:

- mhp-core already supports multiple compositions per cell and multiple job types via `airo_job_apps` (many-to-many)
- The worker task system is modular - new task types (`CreateAgentJobTask`, `SplitUnifiedJobTask`) slot in alongside existing patterns
- All 16 SQLite tables use TEXT primary keys with UUID/nanoid generation - merging N per-app DBs is inserting rows with no ID collisions
- Agent code can be made dual-mode (accept both `siteId` and `customerId` JWTs) so old and new topologies coexist
- Pre-provisioning pools for both agent and app jobs can be filled before migration begins

**Phased rollout:**

**Phase 0 - Preparation (no user-facing changes):**

Most of this is covered in the "Preparatory Work" section above - items that can ship independently on the current architecture. The remaining Phase 0 items that are specific to the migration:

- Complete all preparatory work items (filesystem abstraction, env var lock removal, customerId in AgentContext, siteId decoupling, concurrent write benchmarking).
- Add `job_kind` field to mhp-core's `airo_jobs` table (`unified` | `agent` | `app`) to track split status. Existing jobs default to `unified`.
- Create new compositions: `ai-builder-agent` (agent task only) and `ai-builder-app` (preview + publish only). Deploy alongside existing `ai-builder/v4` unified composition.
- Deploy split Cilium policies (agent + app + cross-job rules) alongside the existing unified policy. Both policies can coexist - they select on different task group IDs.
- Fill agent and app pre-provisioning pools.

**Phase 1 - New customers get split topology:**

- New app creation uses split topology: assign agent from pool + assign app from pool. BFF issues `customerId` JWTs for new customers.
- Existing customers continue on unified `airo-{appId}` jobs with `siteId` JWTs. No disruption.
- Monitor: agent-to-app TCP IPC reliability, cross-job Cilium policy, pre-prov pool consumption rates, WebSocket app-switch behavior.
- This phase validates the new topology under real traffic before touching existing customers.

**Phase 2 - Migrate existing customers (the hard part):**

Per-customer migration, one customer at a time (or in small batches):

1. **Create agent job:** Assign pre-provisioned `airo-agent-{agentId}` to customer. Store `customerId -> agentId` mapping. Agent starts with empty SQLite DB.

2. **Merge SQLite data:** Copy conversation history, app records, memory, todo lists, OAuth tokens, and git config from each of the customer's per-app SQLite DBs into the new customer-level DB. All tables are already keyed by `appId`, so merging is inserting rows from N databases into one. Key considerations:

   - `apps` table rows from each per-app DB get inserted into the agent DB
   - `conversations`, `conversation_messages`, `conversation_summaries` follow via `appId` foreign keys
   - `oauth_tokens`, `git_remote_config`, `social_associations` are per-app and transfer cleanly
   - `file_context` (RAG embeddings) can be regenerated rather than migrated if simpler
   - Primary key conflicts: per-app DBs use auto-increment IDs independently, so IDs will collide. Migration must remap IDs (e.g., prefix with appId or use UUID replacement). Foreign key references (`conversation_messages.conversationId`) must follow.
   - Migration tool should be a CLI command that reads source DBs from Ceph and writes to the agent's DB, runnable as a one-shot Nomad batch job.

3. **Convert app jobs:** For each of the customer's apps:

   - Create `airo-app-{appId}` job (assign from app pool or create fresh). Preview + publish tasks only.
   - App container registers TCP address with agent via `POST /apps/register`.
   - Verify agent can reach app container via TCP IPC (health check).
   - Tear down the old `airo-{appId}` unified job.
   - Brief downtime window per app during the switchover (old job torn down, new job takes over). Can be minimized by starting the new app job before tearing down the old one and switching routing atomically.

4. **Switch BFF auth:** Update customer's JWT issuance from `siteId` to `customerId`. Customer's next WebSocket connection goes to the new agent.

**Phase 3 - Cleanup:**

- Remove `siteId` JWT support from agent code once all customers migrated.
- Remove `unified` composition and `ai-builder/v4` job templates.
- Remove old unified Cilium policy.
- Drop `job_kind = 'unified'` rows from mhp-core.
- Remove dual-mode feature flags.

**Rollback plan:** During Phase 2, each customer's old unified jobs are not torn down until the new topology is verified. If issues are detected, the customer can be reverted to their existing `airo-{appId}` jobs by switching their JWT back to `siteId` and re-pointing routing. The agent DB merge is additive (old per-app DBs on Ceph are not deleted during migration).

**SQLite merge is straightforward.** All 16 tables already use TEXT primary keys with UUID/nanoid generation (no auto-increment integers). Merging N per-app databases into one customer-level database is inserting rows - no ID remapping or schema changes required. The only collision risk is the `apps` table where `id` is the `siteId` string, but each app has a unique siteId by definition.

### Local Dev Parity

Local dev already approximates this model - one agent process on host managing multiple Docker containers. Changes:

- Local control plane creates one agent "service" per customer (or uses the host process as-is)
- App containers created per-app with TCP socket registration (already works)
- Agent DB at a customer-level path instead of per-app
- Minimal disruption to developer workflow

## Preparatory Work (Can Do Now)

These changes are independently valuable and reduce the migration surface when we implement the full split. Each can be shipped as a standalone PR on the current unified architecture with no user-facing impact.

### 1. Complete filesystem abstraction (in progress)

PR #2423 (merged) added `/fs/*` HTTP endpoints to dev-supervisor. PR #2460 (open) adds the `FileSystemOperations` interface with `LocalFileSystemOperations` and `DevSupervisorFileSystemOperations` implementations, and refactors the LLM tools (ReadFileTool, DirectoryListingTool, FileEditTool) to use it.

**Remaining:** Apply the abstraction to services and middleware that still use direct `fs` calls for app directories:

- `AppContextManager.ts` - `readFile()` on package.json
- `git-import-validation.ts` - `existsSync()`, `readFileSync()` for build tool detection
- `apps.ts` routes - `existsSync()`, `writeFileSync()`, `createWriteStream()`
- `DefaultPublishStrategy.ts` - git operations on appPath
- `rebuild-page-selector.ts`, `suggested-response.ts` - workflow-state.json reads

Once complete, the agent has zero direct filesystem dependency on app directories - all access goes through dev-supervisor. This is the single most important preparatory change because it decouples the agent from sharing a filesystem with app containers.

### 2. Remove SITE_ID / CUSTOMER_APP_DIR env var locks

`AppRepository.ts` (lines 110, 122) throws if `process.env.SITE_ID` or `process.env.CUSTOMER_APP_DIR` don't match the incoming request. These enforce single-app-per-agent at the code level.

**Change:** Make these checks conditional on a feature flag or remove them entirely. The agent should accept any app that passes ownership validation, not enforce identity via environment variables. In the current unified topology this is a no-op (only one app connects anyway), but it removes a hard blocker for multi-app support.

### 3. Add customerId to AgentContext

`jwt-auth.ts` currently extracts `siteId` from the JWT and sets it on `AgentContext`. Add `customerId` as an optional field, populated from the JWT if present. This is backward-compatible - existing JWTs without `customerId` continue to work via `siteId`.

This lets middleware and route handlers start using `customerId` before the full migration. The BFF can start including `customerId` in JWT claims alongside `siteId` immediately.

### 4. Add AppRepository.findByCustomerId()

The `apps` table already has a `customerId` column. Add a query method:

```typescript
findByCustomerId(customerId: string): App[]
```

This is used by the future customer-based ownership validation and app-switching protocol. Shipping it now means the data access layer is ready.

### 5. Decouple siteId from "agent identity" vs "app being operated on"

`agentContext.siteId` is used for two distinct purposes across 39+ files:

- **Agent identity** (JWT validation, ownership checks) - 8-10 callsites in middleware
- **Active app identifier** (which app's files/conversations to operate on) - 25+ callsites in routes, services, tools

These are the same value today (1:1 agent:app) but must diverge (1:M customer:apps). Audit the callsites and where possible, refactor to use `appId` from request context (route params, body, query) instead of `agentContext.siteId` when the intent is "the app being operated on." This doesn't change behavior in the current 1:1 model but makes the later migration mechanical.

### 6. Benchmark SQLite concurrent write throughput

WAL mode is already enabled (`schema.ts` line 285). But the current single-app model means write contention is never exercised. Run a benchmark simulating N concurrent conversations writing to `conversation_messages` on one SQLite database to establish a baseline and identify if connection pooling or other changes are needed before multi-app load hits.

### What's already done

- WAL mode enabled (no action needed)
- TEXT primary keys with UUID/nanoid generation across all 16 tables (no ID collision risk during DB merge)
- TCP IPC support in `DevSupervisorClientFactory` (local dev already uses it)
- `apps.customerId` column exists in schema
- dev-supervisor `/fs/*` endpoints merged (PR #2423)

## Key Files Affected

### Infrastructure (mhp-core)

- `backends/hosting/templates/compositions/ai-builder/v4/` - New v5 composition or refactored v4
- Agent job template (new)
- App job template (new, derived from preview/publish tasks)
- Service templates (v2-ingress-proxy routing tags)
- Pre-provisioning: new app-only composition in `hosting_preprov_inventory`, `CreatePreProvAppTask`, `DeployPreProvAppTask` workflows

### Infrastructure (pioneer-infra)

- `ansible/roles/network-policy/templates/airo-networkpolicy.yaml.j2` - Split Cilium policy into agent + app, add cross-job communication rules
- `ansible/roles/selinux/templates/containers-udica-policies/nomad-client-onegroup/` - Update SELinux policies for TCP IPC

### Agent Service

- `agents/src/server/middleware/jwt-auth.ts` - AgentContext: customerId
- `agents/src/server/middleware/app-ownership.ts` - Customer-based ownership validation
- `agents/src/server/ai-lib-websocket-server.ts` - App switching protocol, customer-scoped connections
- `agents/src/database/repositories/AppRepository.ts` - Remove SITE_ID/CUSTOMER_APP_DIR env var locks (lines 110, 122), add findByCustomerId
- `agents/src/database/repositories/ConversationRepository.ts` - Add getByCustomerId
- `agents/src/services/AppContextManager.ts` - Refactor to use dev-supervisor API instead of direct fs
- `agents/src/utils/nomad-config.ts` - Customer-level config (may need per-app extension later)
- `agents/src/server/routes/apps.ts` - Multi-app registration support

### BFF (app/)

- `app/src/app/api/auth/agent-token/route.ts` - customerId in JWT claims
- `app/src/lib/control-plane/v2-control-plane-adapter.ts` - Agent URL discovery
- `app/src/hooks/useStreamingWebSocket.ts` - App switching via message instead of reconnect
- `app/src/services/websocket/StreamingWebSocketController.ts` - App switch protocol

### Dev Supervisor

- No changes required - already supports TCP IPC and per-app routing

### Local Control Plane

- `local-control-plane/internal/docker/` - Customer-level agent container (or keep host process model)
- `local-control-plane/internal/api/` - Customer-scoped app management

## Risks

| Risk                                                     | Severity | Mitigation                                                                                      |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Security regression (ownership validation)               | High     | Comprehensive auth test suite, security review before deploy. Audit all 16+ `siteId` callsites. |
| SQLite write contention under multi-app load             | Medium   | WAL mode already enabled. Benchmark concurrent writes, consider connection pooling.             |
| AppContextManager latency via dev-supervisor             | Medium   | Cache context responses, benchmark against current direct-read baseline                         |
| Blast radius (one agent crash affects all customer apps) | Medium   | Health checks, auto-restart, customer-level isolation still maintained                          |
| Migration data loss (SQLite merge)                       | Medium   | Backup before migration, dry-run tooling, rollback plan                                         |
| Agent memory limits for multi-app workloads              | Medium   | Re-evaluate `--max-old-space-size=384` limit, profile under N-app load                          |
| Cilium cross-job policy                                  | Medium   | New policy type - agent-to-app TCP communication doesn't exist today. Must test in staging.     |
| Pre-prov inventory sizing (two pools)                    | Low      | Agent pool smaller than app pool. Monitor assignment rates to tune inventory targets.           |
| Observability trace correlation                          | Low      | Current traces keyed on `siteId` need migration to `customerId` + `appId` dimensions            |
| Agent prompt changes needed for multi-app awareness      | Low      | Defer to later phase, current prompts work with single active app                               |

## Future Direction: Autonomous Agent Model

The agent-per-customer architecture is a foundation for evolving toward a more autonomous agent model (similar in spirit to frameworks like [OpenClaw](https://openclaw.ai/)). Key enablers this proposal provides:

- **Persistent agent process** - long-lived per-customer, not ephemeral per-request
- **Persistent memory** - customer-level SQLite DB + Ceph workspace survive across sessions
- **Stable endpoint** - customer-level URL enables multi-channel communication (WebSocket, API, future: messaging integrations)
- **Self-modifying skills** - if the agent can write its own skills, the customer Ceph workspace provides persistent storage for them
- **Proactive behavior** - always-on agent can monitor, notify, and act without user prompting

No structural changes to this proposal are needed to support this direction. The architecture is intentionally aligned with it.

## Out of Scope

- Agent prompt refactoring (extracting develop agent into skills) - separate initiative, needs synthetic eval system
- Per-app agent secrets design - flagged as future work
- PaaS product changes - stays per-app (headless, API-driven)
- Multi-tenant base agent (Option 3 from PR #2517) - may not be needed if Option 2 done well
