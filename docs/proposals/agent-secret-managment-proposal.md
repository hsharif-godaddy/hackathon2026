# Agent-Specific Secrets Isolation - Status & Plan

## Problem Statement

As per security requirement, some secrets (e.g. - GITHUB_TOKEN) should only be accessible to the agent container, not preview/publish containers.
<br/>Currently, the agent reads from shared config, creating a potential security risk.

---

## How Current Isolation Works (Preview/Publish)

### Nomad Directory Structure

```
Host Filesystem (Nomad Allocation)
├── alloc/                          # SHARED across all tasks
│   ├── preview-config.json         # Deleted after migration
│   ├── publish-config.json         # Deleted after migration
│   └── config.json                 # SYMLINK → /local/config.json
│
├── preview/
│   └── local/                      # ONLY Preview can see this
│       └── config.json             # Preview's actual config
│
├── publish/
│   └── local/                      # ONLY Publish can see this
│       └── config.json             # Publish's actual config
│
└── agent/
    └── local/                      # ONLY Agent can see this
        └── config.json             # (NOT YET IMPLEMENTED)
```

### Mount-Point Isolation (Key Insight)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              NOMAD ALLOCATION                                     │
│                                                                                   │
│  /alloc (SHARED)                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │  config.json ──SYMLINK──► /local/config.json                             │    │
│  │      ▲                    (resolves differently per task!)               │    │
│  │      │                                                                   │    │
│  │      │ All apps read this path                                           │    │
│  └──────┼───────────────────────────────────────────────────────────────────┘    │
│         │                                                                         │
│         │         ┌─────────────────────────────────────────────┐                │
│         │         │                     │                       │                │
│  ┌──────┴───────────────┐      ┌────────┴─────────┐      ┌──────┴───────────┐    │
│  │ PREVIEW CONTAINER    │      │ PUBLISH CONTAINER│      │  AGENT CONTAINER │    │
│  │                      │      │                  │      │                  │    │
│  │ ┌──────────────────┐ │      │ ┌──────────────┐ │      │ ┌──────────────┐ │    │
│  │ │   CUSTOMER APP   │ │      │ │ CUSTOMER APP │ │      │ │   AI AGENT   │ │    │
│  │ │    (untrusted)   │ │      │ │  (untrusted) │ │      │ │  (trusted)   │ │    │
│  │ └────────┬─────────┘ │      │ └──────┬───────┘ │      │ └──────┬───────┘ │    │
│  │          │           │      │        │         │      │        │         │    │
│  │          │ reads     │      │        │ reads   │      │        │ reads   │    │
│  │          ▼           │      │        ▼         │      │        ▼         │    │
│  │ /alloc/config.json   │      │ /alloc/config.json      │ /alloc/config.json    │
│  │          │           │      │        │         │      │        │         │    │
│  │          │ symlink   │      │        │ symlink │      │        │ symlink │    │
│  │          ▼           │      │        ▼         │      │        ▼         │    │
│  │ /local/config.json   │      │ /local/config.json      │ /local/config.json    │
│  │  (NO GITHUB_TOKEN)   │      │  (NO GITHUB_TOKEN)      │  (HAS GITHUB_TOKEN)   │
│  │                      │      │                  │      │                  │    │
│  │ /local ──────────┼───┤      │ /local ──────┼───┤      │ /local ──────┼───┤    │
│  │ (mounted)        │   │      │ (mounted)    │   │      │ (mounted)    │   │    │
│  └──────────────────┘   │      └──────────────┘   │      └──────────────┘   │    │
│                         │                         │                         │    │
│                         ▼                         ▼                         ▼    │
│               ┌─────────────┐           ┌─────────────┐           ┌─────────────┐│
│               │ preview/    │           │ publish/    │           │ agent/      ││
│               │ local/      │           │ local/      │           │ local/      ││
│               │ config.json │           │ config.json │           │ config.json ││
│               │ (ISOLATED)  │           │ (ISOLATED)  │           │ (MISSING!)  ││
│               └─────────────┘           └─────────────┘           └─────────────┘│
│                                                                                   │
│  Customer app reads /alloc/config.json → symlink resolves to task's /local.      │
│  Each task's /local is bind-mounted to a DIFFERENT physical directory.           │
│  Customer app in preview/publish CANNOT access agent's /local (and vice versa).  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Config Migration Flow (MigrateTaskConfig)

```
STARTUP SEQUENCE
================

1. Pre-start task runs (downloads from S3, generates configs)
   ┌─────────────────────────────────────────────────────┐
   │  /alloc/preview-config.json  ← preview secrets      │
   │  /alloc/publish-config.json  ← publish secrets      │
   │  /alloc/agent-config.json    ← (NOT CREATED YET!)   │
   └─────────────────────────────────────────────────────┘

2. Preview container starts → dev-supervisor MigrateTaskConfig()
   ┌────────────────────────────────────────────────────────────────┐
   │  a) Read /alloc/preview-config.json                           │
   │  b) Write to /local/config.json (preview's isolated /local)   │
   │  c) DELETE /alloc/preview-config.json (security!)             │
   │  d) Create symlink: /alloc/config.json → /local/config.json   │
   └────────────────────────────────────────────────────────────────┘

3. Publish container starts → dev-supervisor MigrateTaskConfig()
   ┌────────────────────────────────────────────────────────────────┐
   │  a) Read /alloc/publish-config.json                           │
   │  b) Write to /local/config.json (publish's isolated /local)   │
   │  c) DELETE /alloc/publish-config.json (security!)             │
   │  d) Symlink already exists (first-writer-wins, OK)            │
   └────────────────────────────────────────────────────────────────┘

4. Agent container starts → nomad_setup_and_serve.sh
   ┌────────────────────────────────────────────────────────────────┐
   │  IF /alloc/agent-config.json EXISTS:                          │
   │    a) Move to /local/config.json                              │
   │    b) Create symlink                                          │
   │  ELSE:                                                        │
   │    ❌ Falls back to reading shared /alloc/config.json         │
   │    ❌ This is the current state - NO ISOLATION for agent!     │
   └────────────────────────────────────────────────────────────────┘
```

---

## Current State vs Target State

### Current State (Problem)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CURRENT STATE                                │
│                                                                  │
│  Pre-start generates:                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  preview-config.json  ──► Contains: DB creds, secrets   │    │
│  │  publish-config.json  ──► Contains: DB creds, secrets   │    │
│  │  (NO agent-config.json!)                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Agent reads from: /alloc/config.json (symlink to preview's!)   │
│                                                                  │
│  ⚠️  PROBLEM: Agent currently sees PREVIEW's config             │
│  ⚠️  If GITHUB_TOKEN was in preview config, preview could       │
│      potentially access it (though currently it's not there)    │
└─────────────────────────────────────────────────────────────────┘
```

### Target State (Goal)

```
┌─────────────────────────────────────────────────────────────────┐
│                     TARGET STATE                                 │
│                                                                  │
│  Pre-start generates:                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  preview-config.json  ──► DB creds, customer secrets    │    │
│  │  publish-config.json  ──► DB creds, customer secrets    │    │
│  │  agent-config.json    ──► DB creds + GITHUB_TOKEN       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Each task reads its OWN isolated config:                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Preview  → /local/config.json (no GITHUB_TOKEN)        │    │
│  │  Publish  → /local/config.json (no GITHUB_TOKEN)        │    │
│  │  Agent    → /local/config.json (has GITHUB_TOKEN)       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ✅ GITHUB_TOKEN only accessible to agent container             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Task Breakdown

### ✅ DONE (Infrastructure Ready)

| #   | Component                             | File                                                              | Status                                                                                        |
| --- | ------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **MigrateTaskConfig()**               | `dev-supervisor/internal/allocconfig/migrate.go`                  | ✅ Complete - Generic, works for any `{taskName}-config.json`                                 |
| 2   | **Agent startup script**              | `agents/management-scripts/nomad_setup_and_serve.sh` (lines 6-11) | ✅ Ready - Already handles `agent-config.json` IF it exists                                   |
| 3   | **Symlink isolation mechanism**       | Nomad + dev-supervisor                                            | ✅ Working for preview/publish                                                                |
| 4   | **Local dev preview/publish configs** | `local-control-plane/internal/setup/template.go`                  | ✅ Creates `preview-config.json` and `publish-config.json`                                    |
| 5   | **Runtime token handling**            | `agents/src/services/GitRemoteTokenManager.ts`                    | ✅ Token passed at runtime, stored in `/tmp/.git-credentials`, cleaned up after git operation |

### ❌ TODO (Needs Implementation)

| #   | Component                                 | Owner                         | Description                                                                                                                                       | Priority |
| --- | ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | **S3: Store agent secrets**               | Control plane / pioneer-infra | Add ability to store `agent/hosting-agent.json` in S3 config tar.gz                                                                               | HIGH     |
| 2   | **Pre-start: Build agent-config.json**    | mhp-core team                 | **NOT copy** preview-config.json to agent-config.json. Instead build: `shared.json` + `preview/hosting-preview.json` + `agent/hosting-agent.json` | HIGH     |
| 3   | **Secrets worker: Push to agent task**    | mhp-core team                 | Update secrets worker to push secrets to agent task                                                                                               | HIGH     |
| 4   | **API consumers: Update target**          | hosting-web-app & AAB         | Once V2 APIs support agent secrets, update requests to target "agent" instead of "preview"                                                        | HIGH     |
| 5   | **Local dev: Generate agent-config.json** | airo-app-builder              | Update `local-control-plane/internal/setup/template.go` to also write `agent-config.json`                                                         | MEDIUM   |

---

## Implementation Plan

### Phase 1: Control Plane Changes (mhp-core)

```
1. Control plane ability to store agent-specific secrets in S3:
   - Store as: agent/hosting-agent.json in config tar.gz

2. Pre-start updated to NOT copy preview-config.json to agent-config.json
   Instead, build agent-config.json that combines:
   - shared.json
   - preview/hosting-preview.json
   - agent/hosting-agent.json

3. Secrets worker updated to push secrets to agent task
```

### Phase 2: API Consumer Updates (hosting-web-app & AAB)

```
1. Once V2 APIs support agent secrets, update API requests:
   - Change target from "preview" to "agent" for agent-specific secrets
   - Update hosting-web-app and AAB app to use new params
```

### Phase 3: Local Dev Support (airo-app-builder)

```
1. Update local-control-plane/internal/setup/template.go:
   - Add agent-config.json to generated configs
   - Include GITHUB_TOKEN only in agent config

2. Update docker compose generation if needed
```

### Phase 4: Validation

```
1. Deploy to test environment
2. Verify:
   - Preview container cannot read GITHUB_TOKEN
   - Publish container cannot read GITHUB_TOKEN
   - Agent container CAN read GITHUB_TOKEN
3. Test secret rotation flow
```

---

## What is NOT Required

| Item                                | Why Not Needed                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Landlock**                        | Mount-point isolation already provides secrets isolation via Nomad's bind-mount per task. Not immediate requirement but may be needed in future for defense-in-depth. |
| **Environment variable injection**  | File-based config works, existing pattern is sufficient. May be considered at later stage per industry standards (12-factor app).                                     |
| **Changes to dev-supervisor**       | `MigrateTaskConfig()` is already generic - works for any `{taskName}-config.json`                                                                                     |
| **Changes to agent startup script** | Already handles `agent-config.json` if present                                                                                                                        |

---

## Questions for Team

1. **Confirm understanding:** Does the symlink + mount isolation diagram accurately represent how Nomad isolates task directories?

2. **S3 structure:** What should the final S3 artifact structure look like for agent-only secrets?

3. **Secret ownership:** Besides GITHUB_TOKEN, what other secrets should be agent-only?

4. **Timeline:** What's the priority for mhp-core changes vs local dev support?

---

## References

- `dev-supervisor/internal/allocconfig/migrate.go` - MigrateTaskConfig implementation
- `agents/management-scripts/nomad_setup_and_serve.sh` - Agent startup script
- `local-control-plane/internal/setup/template.go` - Local dev config generation
- `docs/unified-nomad-job-architecture.md` - Architecture documentation
