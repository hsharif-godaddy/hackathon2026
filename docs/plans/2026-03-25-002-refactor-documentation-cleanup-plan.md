---
title: "refactor: documentation cleanup"
type: refactor
status: completed
date: 2026-03-25
deepened: 2026-03-27
---

# Documentation Cleanup

## Overview

Audit of all repo documentation revealed ~44 gaps ranging from fully dead docs (referencing deleted code) to missing docs for key subsystems. This plan removes dead weight, fixes the highest-leverage files first, and backfills missing docs — all without changing any application code.

## Problem Frame

5 parallel research agents reviewed every `.md` file in the repo against the actual codebase. Findings:

- 9 docs reference entirely deleted code (net-negative — actively mislead)
- Root `README.md` has 12 broken links; `CLAUDE.md` has wrong env path and missing service
- `agents/README.md` is fictional (wrong port, wrong package manager, nonexistent files)
- `packages/ai-lib/` entry-point docs use a removed API (`openAIModels`/`bedrockModels`)
- `dev-supervisor/` docs list wrong Go version and stale file paths
- `local-control-plane/` has no README at all
- `docs/` directory has 100+ files across subdirectories with no index
- 4 overlapping architecture overview docs with no canonical source

## Requirements Trace

- R1. No doc should reference files, classes, or APIs that no longer exist
- R2. CLAUDE.md files must accurately reflect current service structure (tables, agents, tools, directories)
- R3. Entry-point docs (README, CLAUDE.md) must have zero broken links
- R4. Every service directory should have discoverable documentation
- R5. `docs/` should be navigable via an index

## Scope Boundaries

- No application code changes
- No new feature documentation (schema reference, API reference, deployment runbook) — future work, not part of this plan
- No doc metadata convention standardization — future work
- Completed plan docs get status headers, not physical relocation
- File renames are in scope when the filename actively misrepresents content
- Files in `packages/ai-transport/`, `packages/design-extractor/`, `proxy/`, `setup/`, `scripts/`, `e2e/`, `app-templates/v8/` were spot-checked by research agents and found to have no critical broken references. They are out of scope unless issues are discovered during execution.

## Key Technical Decisions

- **Canonical name: `dev-supervisor`** — matches directory, binary, and majority of references. The 3 docs using `airo-supervisor` will be updated.
- **Canonical architecture overview: `CLAUDE.md`** — already the most accurate. `ARCHITECTURE_DOCUMENTATION.md`, `docs/overview.md`, and `docs/ai-hosting-platform-docs.md` will be archived (status header + warning).
- **`docs/thought-exercise/`: add warning headers** — preserve for reference but clearly mark as exploratory/non-current.
- **Status vocabulary:**
  - `status: implemented` — plan docs where the feature shipped
  - `status: superseded` — plan docs replaced by a newer plan
  - `status: not-implemented` — proposals that were never built
  - `status: archived` — reference docs that are no longer canonical (replaced by CLAUDE.md or another doc)
  - `status: completed` — migration guides where the migration is done
  - `status: active` — still relevant, default for anything uncertain

## Open Questions

### Resolved During Planning

- **thought-exercise files?** → Add warning headers (user decision)
- **dev-supervisor vs airo-supervisor?** → `dev-supervisor` (matches code reality)
- **Canonical arch doc?** → CLAUDE.md only; archive others (user decision)
- **Completed plan handling?** → Status headers (user decision)
- **Plan doc statuses?** → Pre-investigated all 49 files. See Appendix A.

### Deferred to Implementation

- **agents/PROPOSAL-file-context-compression-integration.md** — proposal analysis is still valid (FileContextManager has no callers). Mark as `status: not-implemented` but verify whether the underlying problem was solved another way.
- **agents/MEMORY_TOOL_DESIGN.md** — verify exact current tool names before writing divergence note.
- ~~**Root-level PLAN-\*.md files**~~ — **RESOLVED**: All 3 are fully implemented (see Appendix D). Add `status: implemented` headers.

## Implementation Units

### Phase 1: Remove Dead Weight

- [ ] **Unit 1: Delete dead docs**

**Goal:** Remove files where all referenced code has been deleted.

**Requirements:** R1

**Dependencies:** None

**Files:**

- Delete: `SETUP_COLOR_AGENT.md`
- Delete: `SHARED_MYSQL_GUIDE.md`
- Delete: `TOOL_LLM_TRACKING_IMPLEMENTATION.md`
- Delete: `agents/POC_MODE.md`
- Delete: `agents/COMPONENT_GENERATOR_PROMPTS.md`
- Delete: `agents/COMPONENT_TEMPLATE_COMPACT.md`
- Delete: `agents/logging-integration-summary.md`
- Delete: `app/docs/contextual-messaging-pattern.md`
- Delete: `app/src/lib/domains/README.md`
- Add status header: `PLAN-git-commit-hash-in-complete-message.md` (`status: implemented`)
- Add status header: `PLAN-waf-prompt-validation.md` (`status: implemented`)
- Add status header: `TODO_LIST_TOOL.md` (`status: implemented`)

**Approach:**

- Straight `git rm` for confirmed dead files. No content to salvage — every referenced file/class/tool has been removed from the codebase.
- `TOOL_LLM_TRACKING_IMPLEMENTATION.md` content lives in `packages/ai-lib/TOOL_LLM_HELPER.md`
- `domains/README.md` is a byte-for-byte copy of `mgmt-airo/README.md` with wrong class name
- The 3 "verify" files are all **fully implemented** (pre-verified):
  - `PLAN-git-commit-hash`: `handleConnectionEnd()` returns commit hash, `beforeMessageComplete` callback wired in `ai-lib-websocket-server.ts:1563-1606`
  - `PLAN-waf-prompt-validation`: `app/src/lib/waf-validation.ts` created, byte validation in `HeroSection.tsx`, server-side in `quick-create/route.ts`
  - `TODO_LIST_TOOL`: `TodoListRepository` in `agents/src/database/repositories/`, tool in `agents/src/tools/todo-list-tool.ts`, 11 passing tests

**Verification:**

- `git status` shows only deletions and expected modifications
- All root-level `PLAN-*.md` and `TODO_LIST_TOOL.md` files have `status: implemented` headers

### Phase 2: Fix CLAUDE.md Files (Highest Leverage)

- [ ] **Unit 2: Fix root CLAUDE.md**

**Goal:** Fix broken references and add missing service.

**Requirements:** R2, R3

**Dependencies:** None

**Files:**

- Modify: `CLAUDE.md`

**Approach:**

- Fix `app/.env.example` → `app/.env` (file doesn't have `.example` suffix — only `app/.env` exists, unlike `agents/.env.example` which does)
- Add `local-control-plane/` row to Services table: `| local-control-plane/ | Go binary | 4100 | Local mgmt-airo API, SQLite + Docker |`
- Add `[local-control-plane/](local-control-plane/CLAUDE.md)` to "See service-specific CLAUDE.md files" line (line 53)
- All 7 "Additional Documentation" links verified — all resolve correctly. No fixes needed there.

**Patterns to follow:**

- Existing Services table format in CLAUDE.md

**Verification:**

- `app/.env` referenced (not `app/.env.example`)
- `local-control-plane/` appears in Services table and CLAUDE.md file list

- [ ] **Unit 3: Fix agents/CLAUDE.md**

**Goal:** Update DB tables, agent list, tool count, prompt dirs, and add skills reference.

**Requirements:** R2

**Dependencies:** None

**Files:**

- Modify: `agents/CLAUDE.md`
- Reference: `agents/src/database/schema.ts` (source of truth for tables)
- Reference: `agents/src/agents/` (source of truth for agent list)
- Reference: `agents/src/tools/ai-lib-tools/index.ts` (source of truth for tools)
- Reference: `agents/src/prompts/` (source of truth for prompt dirs)
- Reference: `agents/src/skills/` (source of truth for skills)

**Approach:**

Database tables (7 missing, 1 phantom):

- Add: `running_processes`, `memory`, `import_jobs`, `conversation_summaries`, `share_tokens`, `social_associations`, `social_posts`
- Remove: `token_usage` (not in schema.ts)
- Keep: `apps`, `conversations`, `conversation_messages`, `git_remote_config`, `oauth_tokens`, `file_context`
- Final count: 13 tables

Agent list (3 missing, 1 phantom):

- Add: `PagePromptAgent` (page-prompt-agent.ts), `SiteAnalyzerAgent` (site-analyzer-agent.ts), `ExampleAgent` (example-agent.ts)
- Remove: `CommerceAgent` (no agent file — commerce is a skill, not an agent)
- Keep: `InitialAgent`, `DevelopAgent`, `MarketingAgent`, `DesignAgent`
- Final count: 7 agents

Tool count:

- Current claim: ~50 tools
- Actual count in `allAILibTools`: 44
- Update to "44 tools"

Prompt directories (6 missing):

- Current: `develop/`, `shared/`, `template-descriptions/`
- Add: `design/`, `initial/`, `example/`, `marketing/`, `color-scheme/`, `font-tool/`
- Final count: 9 directories (+ `template-descriptions/`)

Skills (not listed):

- 16 skill directories exist: `authentication`, `blog`, `blog-writing`, `commerce`, `commerce-one-time-payment`, `commerce-storefront`, `google-maps`, `i18n`, `media`, `online-appointments`, `seo`, `social-platform`, `social-posts`, `social-publish`, `stripe`, `database`
- Add brief skills list or reference to `agents/src/skills/README.md`

**Verification:**

- Table count in CLAUDE.md matches `schema.ts` (13)
- Agent count in CLAUDE.md matches `ls agents/src/agents/*.ts | grep -v index` (7)
- Prompt dir count matches `ls agents/src/prompts/` (10)
- Tool count matches `allAILibTools` array length (44)

- [ ] **Unit 2b: Verify app/CLAUDE.md**

**Goal:** Verify app/CLAUDE.md accuracy against current codebase.

**Requirements:** R2

**Dependencies:** None

**Files:**

- Modify (if needed): `app/CLAUDE.md`

**Approach:**

- Read `app/CLAUDE.md` and spot-check key claims: routes, component structure, test patterns, referenced files
- Fix any broken references found
- If accurate, no changes needed

**Verification:**

- Every file path referenced in `app/CLAUDE.md` exists

### Phase 3: Fix Entry-Point Docs

- [ ] **Unit 4: Fix packages/ai-lib docs**

**Goal:** Update all ai-lib entry-point docs to reference the current `getModel()` API instead of removed `openAIModels`/`bedrockModels`. Fix 40+ broken references total.

**Requirements:** R1, R3

**Dependencies:** None

**Files:**

- Modify: `packages/ai-lib/README.md` (lines 49, 56, 62, 99, 105, 293, 300 — `openAIModels`/`bedrockModels` refs)
- Modify: `packages/ai-lib/SETUP.md` (lines 74, 79 — `openAIModels`/`bedrockModels` refs)
- Modify: `packages/ai-lib/INTEGRATION_GUIDE.md` (50+ instances — `openaiModels`/`bedrockModels` refs, wrong `Agent` class, wrong imports throughout)
- Modify: `packages/ai-lib/docs/delegation-and-handoff.md` (lines 21, 38, 199, 216, 410, 412)
- Modify: `packages/ai-lib/docs/handoff-state-manager.md` (lines 18, 60, 97, 115, 124, 141, 150, 159, 181, 189 — 10 non-existent method refs)
- Modify: `packages/ai-lib/UNIFIED-PROVIDER-MIGRATION.md` (add `status: completed`)
- Modify: `packages/ai-lib/WEBSOCKET-SCHEMA-MIGRATION.md` (add `status: completed`)
- Modify: `packages/ai-lib/STREAMGENERATE-API-UPDATE.md` (add `status: completed`)
- Reference: `packages/ai-lib/src/providers/unified-provider.ts` (source of truth for `getModel()`)
- Reference: `packages/ai-lib/src/index.ts` (source of truth for exports)

**Approach:**

README.md + SETUP.md (model refs):

- Replace all `openAIModels.*()` / `bedrockModels.*()` with `getModel()`. See Appendix B.
- Import: `import { getModel, getEmbeddingModel } from '@airo/ai-lib'`

INTEGRATION_GUIDE.md (heaviest — 50+ broken refs):

- Replace `openaiModels`/`bedrockModels` everywhere → `getModel()`
- Replace `Agent` class → `AgentWrapper` (or verify actual class name)
- Replace `new Agent({...})` → `agentFactory.defineAgents()`
- Verify `findMostSimilar`, `cosineSimilarity` exports (line 261)
- This file needs near-complete rewrite of all code examples

delegation-and-handoff.md:

- Line 21: `createHandoffHelpers` → `createInMemoryHandoffStateManager`
- Line 38: `createHandoffTool({agents, sourceAgentId, stateManager, sessionId})` → remove `agents` param, use `{sourceAgentId, validTargets, stateManager?, sessionId?}`
- Lines 199, 216: Remove refs to `createHandoffLogger`, `createHandoffValidator` (not exported)
- Line 410: Remove dead link to `./agent-factory.md`
- Line 412: Remove dead link to `./tools.md`

handoff-state-manager.md (10 non-existent methods):

- Line 18: Fix `createHandoffTool` signature (remove `agents` param)
- Line 60: `stateManager.getOrCreateSession()` doesn't exist
- Line 97: `switchAgent(sessionId, targetAgentId, reason?)` → param is `prompt`, not `reason`
- Lines 115, 124, 141, 150, 159, 181, 189: Methods `getOrCreateSession`, `getSessionHistory`, `getActiveSessions`, `getSessionCount`, `getStats`, `clearAllSessions`, `stopCleanup` don't exist — remove or verify against actual SessionStateManager

Migration docs: Add `status: completed` frontmatter to 3 files.

**Verification:**

- `grep -r 'openAIModels\|bedrockModels\|openaiModels' packages/ai-lib/**/*.md` returns zero
- `grep -r 'agent-factory.md\|tools.md' packages/ai-lib/docs/` returns zero
- `grep -r 'createHandoffHelpers\|createHandoffLogger\|createHandoffValidator' packages/ai-lib/**/*.md` returns zero

- [ ] **Unit 5: Fix root README.md**

**Goal:** Fix 12 broken doc links in Documentation Structure section.

**Requirements:** R3

**Dependencies:** None

**Files:**

- Modify: `README.md`

**Approach:**

8 links relocated to `docs/thought-exercise/` (fix paths):

- Line 74: `./docs/platform-architecture.md` → `./docs/thought-exercise/platform-architecture.md`
- Line 76: `./docs/architecture-diagrams.md` → `./docs/thought-exercise/architecture-diagrams.md`
- Line 80: `./docs/tech-stack.md` → `./docs/thought-exercise/tech-stack.md`
- Line 81: `./docs/development-features.md` → `./docs/thought-exercise/development-features.md`
- Line 85: `./docs/agent-features.md` → `./docs/thought-exercise/agent-features.md`
- Line 86: `./docs/ai-features.md` → `./docs/thought-exercise/ai-features.md`
- Line 90: `./docs/hosting-features.md` → `./docs/thought-exercise/hosting-features.md`
- Line 91: `./docs/security-features.md` → `./docs/thought-exercise/security-features.md`

4 links to completely missing files (remove):

- Line 75: `./docs/hosting-architecture.md` — no file exists anywhere
- Line 87: `./docs/image-search-feature.md` — no file exists (related docs in `image-search-service/docs/` only)
- Line 88: `./docs/image-generation-feature.md` — no file exists
- Line 89: `./docs/getty-images-feature.md` — no file exists

Clone directory name (line 24): `cd airo-app-builder` — already correct, no fix needed.
GETTING_STARTED.md link (line 32): already correct.

**Verification:**

- Every `[text](./docs/...)` link in README.md resolves to an existing file
- Zero links to `./docs/*.md` that bypass the `thought-exercise/` subdirectory

- [ ] **Unit 6: Rewrite agents/README.md**

**Goal:** Replace fictional README with accurate service overview.

**Requirements:** R1, R4

**Dependencies:** None (can reference agents/CLAUDE.md as-is or as updated by Unit 3 — either works since the README will link to CLAUDE.md rather than duplicate its content)

**Files:**

- Modify: `agents/README.md`

**Approach:**

- Rewrite from scratch. Keep it concise — CLAUDE.md is the detailed reference
- Cover: what the service does, correct port (4000), correct package manager (pnpm), how to run/test, pointer to CLAUDE.md for details
- Do not duplicate CLAUDE.md content — just summarize and link

**Patterns to follow:**

- `dev-supervisor/README.md` structure (overview, quick start, link to CLAUDE.md)

**Verification:**

- Every file path, command, and port number in the README matches reality

### Phase 4: Fix Service-Specific Docs

- [ ] **Unit 7: Fix dev-supervisor docs**

**Goal:** Fix wrong Go version, stale file paths, missing subsystem docs.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**

- Modify: `dev-supervisor/README.md` (lines 91, 268-302)
- Modify: `dev-supervisor/docs/DEVELOPMENT.md` (lines 21, 104, 168, 173, 259)
- Modify: `dev-supervisor/CLAUDE.md` (lines 66-89)
- Skip: `dev-supervisor/docs/SANDBOX.md` (verified: all "planned" items still planned — no sandbox env vars in config.go, no sandbox code in command_executor.go or managed_process.go)
- Skip: `dev-supervisor/docs/http-request-flow.md` (verified accurate)

**Approach:**

README.md fixes (10 inaccuracies):

- Line 91: Go version `1.21` → `1.25` (go.mod says 1.25, Makefile forces 1.25.7)
- Lines 272-277: Project structure tree shows `main.go`, `api.go`, `command_executor.go`, `environment_manager.go`, `logging.go` at root — they're actually in `cmd/dev-supervisor/`
- Lines 286-289: Test files shown at root — actually in `cmd/dev-supervisor/` (11 test files: `api_test.go`, `api_unpublish_test.go`, `cli_test.go`, `command_executor_test.go`, `docker_integration_test.go`, `environment_manager_test.go`, `integration_test.go`, `logging_test.go`, `main_test.go`, `port_restart_test.go`, `prune_race_test.go`)
- Missing directories: `cmd/` (parent), `cmd/airo-sandbox/`, `examples/`, `internal/allocconfig/`, `internal/middleware/`, `internal/validation/`, `internal/proxy/http/` (only `proxy/smtp/` shown)

DEVELOPMENT.md fixes (5 inaccuracies):

- Line 21: Go version `1.21` → `1.25`
- Line 104: `pid1_manager*.go` → `internal/process/manager*.go`
- Line 168: `pid1_orphan_reaper_linux.go` → `internal/process/reaper_linux.go`
- Line 173: `pid1_manager_unix.go` → `internal/process/manager_unix.go`
- Line 259: `pid1_linux_test.go` → `internal/processmanager/pid1_linux_test.go`

CLAUDE.md fixes (2 missing packages):

- Add `internal/allocconfig/` (config file loading from /alloc/config.json)
- Add `internal/middleware/` (connection tracking, peer validation, method validation)

**Verification:**

- Go version in docs matches `go.mod` (1.25)
- Every file path in README and DEVELOPMENT.md exists
- `internal/` tree in CLAUDE.md matches `ls internal/`

- [ ] **Unit 8: Fix local-control-plane docs**

**Goal:** Create README and fix CLAUDE.md tree.

**Requirements:** R4

**Dependencies:** None

**Files:**

- Create: `local-control-plane/README.md`
- Modify: `local-control-plane/CLAUDE.md`

**Approach:**

- Write README covering: purpose (local mgmt-airo simulator), port (4100), prerequisites (Go 1.25, Docker, gofumpt), how to run, architecture overview, link to CLAUDE.md
- Update CLAUDE.md tree: add `internal/auth/` (JWT signing) and `docker/mysql.go` (MySQL provisioning)
- Document `gofumpt` as prerequisite for `make fmt`

**Patterns to follow:**

- `dev-supervisor/README.md` structure

**Verification:**

- README covers setup, running, and architecture
- CLAUDE.md tree matches actual directory listing

### Phase 5: Docs Directory Organization

- [ ] **Unit 9a: Create docs/ index**

**Goal:** Make the docs directory navigable with a categorized table of contents.

**Requirements:** R5

**Dependencies:** Should run after Unit 1 (so deleted files aren't indexed) and ideally after Unit 12 (so plan statuses are known). If running before Unit 12, the Plans section can list files without status annotations.

**Files:**

- Create: `docs/README.md`

**Approach:**

- Use the pre-drafted index in Appendix C as the starting point
- Categories: Architecture, Security, Operations, Features, PaaS, Skills, Plans (with sub-sections for core, PaaS, superpowers), Social, Tech Debt, Brainstorms, Ideation, Solutions, Superpowers Specs, Thought Exercise
- Each entry: relative link + one-line description
- Add note at top that thought-exercise docs are exploratory

**Verification:**

- Every `.md` file under `docs/` appears in the index (spot-check with `find docs/ -name "*.md" | wc -l`)

- [ ] **Unit 9b: Fix stale content in docs/ files**

**Goal:** Archive redundant arch docs, label thought-exercise, fix naming references.

**Requirements:** R1

**Dependencies:** None

**Files:**

- Modify: `docs/thought-exercise/platform-architecture.md` (and 7 siblings: `agent-features.md`, `ai-features.md`, `architecture-diagrams.md`, `development-features.md`, `hosting-features.md`, `security-features.md`, `tech-stack.md` — all confirmed exploratory/speculative)
- Modify: `ARCHITECTURE_DOCUMENTATION.md` (add `status: archived` — duplicates CLAUDE.md's services table, dual-product arch, V4 dir structure, key commands)
- Modify: `docs/overview.md` (add `status: archived` — intermediate abstraction of deployment topology already in CLAUDE.md)
- Modify: `docs/ai-hosting-platform-docs.md` (add `status: archived` — middleman doc pointing to other docs)
- Rename: `docs/security-threat-modeling.md` → `docs/agent-tool-inventory.md` (2001-line file titled "Agent Architecture Documentation" covering 14 tools, auth, network config — not threat modeling)
- Modify: `docs/unified-nomad-job-architecture.md` (fix `airo-supervisor` → `dev-supervisor`, 4 instances: lines 62, 101, 487, 544)
- Modify: `docs/persistent-storage-architecture.md` (fix `airo-supervisor` → `dev-supervisor`, 1 instance: line 349)
- Modify: `docs/onprem-hosting-architecture.md` (fix `airo-supervisor` → `dev-supervisor`, **16+ instances**: lines 43-44, 110, 143-157, 163, 183, 190, 193, 197, 285, 290, 293-294, 301, 303 — section headers, mermaid diagrams, socket paths, security model)

**Approach:**

- Add to each thought-exercise file: `> **Note: This is an exploratory design exercise and does not reflect the current architecture. See root CLAUDE.md for the actual system design.**`
- Add `status: archived` + note to the 3 redundant arch docs pointing to CLAUDE.md as canonical
- Rename security-threat-modeling.md to match actual content (agent tool inventory). Commit rename separately to keep git history clean.
- Fix `airo-supervisor` → `dev-supervisor` in 3 docs. Note: `onprem-hosting-architecture.md` has heavy usage including section headers ("### airo-supervisor Socket Interface"), mermaid diagrams, and socket path strings — use find-and-replace but manually verify mermaid syntax after.
- Note: 5 additional files in code (`dev-supervisor/.gitignore`, `internal/config/config.go`, `cmd/dev-supervisor/main.go`, `test/docker-integration-tests.sh`, `agents/management-scripts/nomad_setup_and_serve.sh`) also reference `airo-supervisor` but are **out of scope** (no application code changes per scope boundaries)

**Verification:**

- All 8 thought-exercise files have warning header
- Zero grep matches for `airo-supervisor` in `docs/` directory
- `docs/agent-tool-inventory.md` exists, `docs/security-threat-modeling.md` does not

### Phase 6: Fix Remaining Stale Docs

- [ ] **Unit 10: Fix remaining agents/ docs**

**Goal:** Fix broken references in agents subdocs and update skills README.

**Requirements:** R1

**Dependencies:** None

**Files:**

- Modify: `agents/src/skills/README.md` (line 249 — claims 2 skills, actually 15)
- Modify: `agents/CONTEXT_DEBUGGING_GUIDE.md` (line 37 — refs deleted file)
- Modify: `agents/docs/SUMMARIZATION.md` (lines 63-69, 149-154 — refs 3 non-existent strategies)
- Modify: `agents/docs/rag-search-tool.md` (lines 351-355 — refs non-existent `qdrant-service.md`, `memory-tool.md`, `design-agent.md`)
- Modify: `agents/docs/knowb-search.md` (line 215 — dead `mediasearch.md` link; line 217 — wrong RAG tool path)
- Modify: `agents/docs/grant-consumption.md` (verify impl status — lines 68-104 have checkboxes claiming complete)
- Skip: `agents/docs/AI_SDK_DEVTOOLS.md` (verified current, no broken refs)
- Modify: `agents/docs/website-scraper-tool.md` (file extensions use `.js` but project is `.ts`)
- Modify: `agents/PROPOSAL-file-context-compression-integration.md` (add `status: not-implemented`)
- Modify: `agents/MEMORY_TOOL_DESIGN.md` (add divergence note)

**Approach:**

Skills README (critical — 2 of 15 listed):

- Update "Available Skills" to list all 15: `authentication`, `blog`, `blog-writing`, `commerce`, `commerce-one-time-payment`, `commerce-storefront`, `google-maps`, `i18n`, `media`, `online-appointments`, `seo`, `social-platform`, `social-posts`, `social-publish`, `stripe`

CONTEXT_DEBUGGING_GUIDE:

- Line 37: `conversation-websocket-wrapper.ts` → likely `ai-lib-websocket-server.ts` (verify during impl)

SUMMARIZATION.md:

- Remove non-existent strategies from changelog/list: `FileEditCompressionStrategy`, `FileEditInputCompressionStrategy`, `HotFileInclusionStrategy`
- Update strategy list to actual 8: `AppContextRemovalStrategy`, `CssSuggestCompressionStrategy`, `DuplicateFileReadStrategy`, `MediaSearchSummaryStrategy`, `SecretOperationCompressionStrategy`, `TodoListRemovalStrategy`, `ToolResultCompressionStrategy`, plus verify one more

rag-search-tool.md:

- Lines 351-355: Remove or fix "See Also" links to `./qdrant-service.md`, `./memory-tool.md`, `./design-agent.md` — none exist in `agents/docs/`

knowb-search.md:

- Line 215: Remove dead `[Media Search Tool](./mediasearch.md)` link
- Line 217: Fix `[RAG Tool](../src/tools/rag-tool.ts)` → `[RAG Search Tool](./rag-search-tool.md)`

website-scraper-tool.md:

- Fix `.js` extensions → `.ts` throughout

PROPOSAL + MEMORY_TOOL_DESIGN:

- Add `status: not-implemented` to PROPOSAL (FileContextManager still has zero callers)
- Add divergence note to MEMORY_TOOL_DESIGN (impl uses SQLite, 5 separate tools)

**Verification:**

- Skills README count matches `ls agents/src/skills/ | wc -l` (15)
- Zero broken cross-reference links in `agents/docs/`
- `grep -r 'mediasearch.md\|qdrant-service.md\|memory-tool.md\|design-agent.md' agents/docs/` returns zero

- [ ] **Unit 11: Fix remaining app/ and root docs**

**Goal:** Fix stale references in app and root-level docs.

**Requirements:** R1

**Dependencies:** None

**Files:**

- Modify: `app/src/lib/mgmt-airo/README.md` (lines 197-205 — migration section may conflict with V2_INTEGRATION.md)
- Modify: `app/src/app/develop/components/tool-renderers/README.md` (lines 221-237 — Phase 2 features not clearly marked as planned)
- Modify: `app/README.md` (line 388-389 — `/tmp/apps` reference; control plane mixing unclear)
- Modify: `V2_INTEGRATION.md` (line 540, 1046 — verify `control-plane/factory.ts` exists or is now `adapter-factory.ts`)
- Modify: `GETTING_STARTED.md` (line 388-389 — `/tmp/apps` → `/tmp/airo-app-builder/{appId}/`)
- Modify: `LOGGING-GUIDE.md` (lines 78-81, 186-191 — `templateVersion: 'v3'` in examples; add explicit no-emoji rule)
- Modify: `changelog.md` (line 3 — "Next Release target 2025-10-01" is 6 months past)

**Approach:**

mgmt-airo README:

- Fix `jest.fn()` → `vi.fn()` (project uses Vitest)
- Lines 197-205: Reconcile "Migration from V2ControlPlaneAdapter" section with V2_INTEGRATION.md — if migration is done, mark section as historical context; if V2 is current, ensure descriptions align

tool-renderers README:

- Lines 221-237: Mark future custom renderers (`FileEditToolRenderer`, `FileDiffToolRenderer`, `DatabaseQueryToolRenderer`) clearly as "Planned (Phase 2)" — not yet implemented
- Update file count if architecture section understates the 40+ files

app/README:

- Fix stale `/sites` route reference
- Clarify which control plane is active (V2 vs legacy)

V2_INTEGRATION.md:

- Verify `control-plane/factory.ts` at line 540 — may need `adapter-factory.ts`
- Remove any references to deleted file paths

GETTING_STARTED.md:

- Fix `/tmp/apps` → `/tmp/airo-app-builder/{appId}/`
- Clarify local dev vs V2 deployment model sections

LOGGING-GUIDE.md:

- Fix `templateVersion: 'v3'` → `v8` in examples
- Add explicit "no emojis in log output" rule consistent with CLAUDE.md logging guidance

changelog.md:

- Update stale "Next Release target 2025-10-01" header — either update date or mark as historical

**Verification:**

- Zero references to `/tmp/apps` in GETTING_STARTED.md
- Zero references to `templateVersion: 'v3'` in LOGGING-GUIDE.md
- Zero references to `control-plane/factory.ts` (without `adapter-` prefix) in V2_INTEGRATION.md
- `jest.fn` does not appear in `app/src/lib/mgmt-airo/README.md`

- [ ] **Unit 12: Add status headers to plan docs**

**Goal:** Mark completed/superseded plan docs so active plans are distinguishable.

**Requirements:** R1

**Dependencies:** None

**Files:**

- Modify: Files in `docs/plans/` (~35 files)
- Modify: Files in `docs/paas/plans/` (~7 files)
- Modify: Files in `docs/superpowers/plans/` (~4 files)
- Modify: Files in `docs/superpowers/specs/` (~3 files)

**Approach:**

- Apply the pre-investigated statuses from Appendix A. All 49 files have been checked against the codebase.
- Add frontmatter with appropriate status value to each file
- Do not change content — just add the status field
- For the 8 files marked `active`, verify they are still in progress before confirming

**Verification:**

- Every file in `docs/plans/`, `docs/paas/plans/`, `docs/superpowers/plans/`, and `docs/superpowers/specs/` has a `status:` field in frontmatter

## System-Wide Impact

- **No code changes** — this plan modifies only `.md` files

### CLAUDE.md Consumption Paths (5 files affected)

| Consumer             | How it uses CLAUDE.md                                                                                             | Impact of fixes                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Claude Code CLI**  | Auto-loads root + service-specific CLAUDE.md into conversation context                                            | Fixing wrong paths/missing services directly improves agent decisions     |
| **GitHub Actions**   | `.github/workflows/claude-code-review.yml` explicitly loads CLAUDE.md for PR review conventions                   | Accurate CLAUDE.md = more relevant automated review comments              |
| **Application code** | `app/src/lib/gd-auth-service.ts` cites CLAUDE.md rules in a security exception comment                            | No functional impact, but the comment stays accurate                      |
| **Cross-references** | Root CLAUDE.md links to `agents/CLAUDE.md`, `app/CLAUDE.md`, `dev-supervisor/CLAUDE.md` as authoritative sub-docs | Fixing sub-docs fulfills the promise made by root                         |
| **Other markdown**   | 17+ files across `cdk/`, `image-search-service/`, `app/`, `debug-console/` reference CLAUDE.md                    | These docs link to CLAUDE.md as canonical — accuracy improvements cascade |

### Deletion Safety

All 9 files marked for deletion in Unit 1 have **zero inbound links** from other markdown files (verified by grep). Safe to `git rm` without cascading link breakage.

### docs/README.md Creation

No existing file links to `docs/README.md` (it doesn't exist yet). Root `README.md` links into `docs/` via individual file paths — those links will remain valid. The new index is additive.

### airo-supervisor Naming Scope

`airo-supervisor` appears in 8 files total: 3 in `docs/` (in scope, ~21 instances) and 5 in code files (out of scope per "no application code changes"). The 5 code files (`dev-supervisor/.gitignore`, `internal/config/config.go`, `cmd/dev-supervisor/main.go`, `test/docker-integration-tests.sh`, `agents/management-scripts/nomad_setup_and_serve.sh`) should be tracked as separate follow-up work.

## Risks & Dependencies

- **Risk: Stale content not caught** — 9 research agents were thorough but may have missed some broken references. Each unit should verify its own changes against the codebase during execution.
- **Risk: Plan doc status misjudgment** — some plans may be partially implemented. When in doubt, mark as `status: active` rather than guessing.
- **Risk: Pre-commit hooks on rename** — the `docs/security-threat-modeling.md` rename (Unit 9b) is a `git mv`. If pre-commit hooks cause issues, commit the rename separately.
- **Risk: onprem-hosting-architecture.md mermaid breakage** — this file has 16+ `airo-supervisor` instances including mermaid diagram labels, subgraph names, and socket path strings. Find-and-replace must be followed by manual mermaid syntax verification.
- **Risk: V2_INTEGRATION.md ↔ mgmt-airo README conflict** — these two files give potentially conflicting descriptions of the V2 control plane migration status. Reconcile during Unit 11, not independently.
- **Dependency: None external** — all work is within this repo, no PRs or services to coordinate with.

## Sources & References

- Gap analysis: 5 parallel research agents covering root docs, agents/, app/+packages/, docs/, dev-supervisor/+local-control-plane/
- Deepening round 1: coherence reviewer, scope guardian, feasibility reviewer, spec flow analyzer
- Deepening round 2: plan status investigator, docs index drafter, ai-lib API researcher
- Deepening round 3: Units 10-11 auditor, dev-supervisor auditor, Unit 9b naming/archival auditor, CLAUDE.md impact analyzer
- Related code: `agents/src/database/schema.ts`, `agents/src/agents/`, `agents/src/tools/ai-lib-tools/index.ts`, `packages/ai-lib/src/providers/unified-provider.ts`

---

## Appendix A: Pre-Investigated Plan Doc Statuses

Apply these statuses in Unit 12. All 49 files checked against codebase on 2026-03-25.

### docs/plans/ (35 files)

| File                                                    | Status          | Evidence                                                       |
| ------------------------------------------------------- | --------------- | -------------------------------------------------------------- |
| 2026-02-03-file-manager-design.md                       | not-implemented | No FileUploadService.ts; no chat uploads infrastructure        |
| 2026-02-03-file-manager-implementation.md               | not-implemented | Depends on unexecuted design                                   |
| 2026-02-05-full-app-screenshot.md                       | implemented     | Screen Capture API implemented; doc already says "Implemented" |
| 2026-02-09-chat-history-pagination-design.md            | not-implemented | No cursor-based pagination found                               |
| 2026-02-16-enable-media-slots-default-design.md         | implemented     | Feature flag removed; mediaSearch tool deleted                 |
| 2026-02-16-enable-media-slots-default.md                | implemented     | media-search-tool.ts deleted; media slots is default           |
| 2026-02-16-media-skill-fixes-design.md                  | implemented     | skill.md updated with "AI generation only" guidance            |
| 2026-02-16-media-skill-fixes.md                         | implemented     | Skill prompt updated; generation renderers standardized        |
| 2026-02-16-media-slot-upload-design.md                  | implemented     | ImageProcessingService.ts exists                               |
| 2026-02-16-media-slot-upload-implementation.md          | implemented     | Tests exist; upload endpoint in media.ts route                 |
| 2026-02-18-qdrant-cdk-stack-design.md                   | implemented     | qdrant-stack.ts exists in cdk/lib/                             |
| 2026-02-18-qdrant-cdk-stack-implementation.md           | implemented     | Stack deployed; bumped to qdrant 1.16.3                        |
| 2026-02-18-signed-file-urls-design.md                   | implemented     | file-url-signer.ts exists; HMAC signing implemented            |
| 2026-02-18-signed-file-urls-implementation.md           | implemented     | Tests exist; files.ts route handles signed URLs                |
| 2026-02-19-budget-service-design.md                     | implemented     | budget-service deployed                                        |
| 2026-02-19-budget-service-integration-testing-design.md | implemented     | Integration tests and Docker Compose deployed                  |
| 2026-02-20-image-search-testing-ui-design.md            | active          | JOMAX token support; partial implementation                    |
| 2026-02-20-image-search-testing-ui.md                   | active          | Plan exists; enhancements in progress                          |
| 2026-02-20-logo-generation-v2-design.md                 | implemented     | LogoService.ts updated; v2 API schema done                     |
| 2026-02-20-logo-generation-v2-implementation.md         | implemented     | Git commit merged (#1903)                                      |
| 2026-02-25-eval-snapshots-design.md                     | implemented     | eval-snapshots-stack.ts created                                |
| 2026-02-25-eval-snapshots-implementation.md             | implemented     | CDK stack deployed                                             |
| 2026-02-26-essp-credentials-tool-design.md              | implemented     | essp-creds.sh exists in scripts/                               |
| 2026-02-26-image-search-enhancements-design.md          | active          | Getty filter expansion in progress                             |
| 2026-02-27-publish-deployment-strategy-design.md        | implemented     | Strategy pattern merged (#1856)                                |
| 2026-03-03-logo-rest-api-migration.md                   | superseded      | S2S auth approach may be outdated                              |
| 2026-03-05-graceful-shutdown-git-commit-design.md       | implemented     | getGitHookService() exists                                     |
| 2026-03-06-go-agent-design.md                           | active          | go-agent/ directory exists; active PRs                         |
| 2026-03-06-go-agent-implementation.md                   | active          | Go agent foundation in progress                                |
| 2026-03-09-conversation-export-tool-design.md           | implemented     | conversation-exporter.ts exists                                |
| 2026-03-10-commerce-skill-design.md                     | implemented     | Commerce skill merged (#1997)                                  |
| 2026-03-10-commerce-skill-implementation.md             | implemented     | Commerce skill tools in agents/src/skills/commerce/            |
| 2026-03-20-001-refactor-runtime-perf-quick-wins-plan.md | active          | 6 perf improvements; partially implemented                     |
| 2026-03-25-001-feat-aws-credential-auto-resolve-plan.md | implemented     | Git commit dcbeb8697                                           |
| 2026-03-25-002-refactor-documentation-cleanup-plan.md   | active          | This plan                                                      |

### docs/paas/plans/ (6 files)

| File                                             | Status          | Evidence                                    |
| ------------------------------------------------ | --------------- | ------------------------------------------- |
| 2025-02-12-vite-port-injection-design.md         | not-implemented | No ViteConfigModifier update found          |
| 2026-01-27-paas-git-push-allowlist.md            | not-implemented | No git push filtering with allowlist found  |
| 2026-01-28-host-paas-aab-integration-proposal.md | superseded      | Proposal doc; integration logic may differ  |
| 2026-02-06-paas-express-support.md               | implemented     | Git commit merged; NODEJS_BUILD_TOOL exists |
| 2026-02-06-paas-express-support-code-snippets.md | implemented     | Express detection implemented               |
| 2026-02-06-zip-import-cleanup-files.md           | not-implemented | No CodeSyncFileCleanupService found         |

### docs/superpowers/plans/ (4 files)

| File                                    | Status      | Evidence                               |
| --------------------------------------- | ----------- | -------------------------------------- |
| 2026-03-17-git-recovery-coordination.md | implemented | All 3 PRs merged                       |
| 2026-03-17-setup-execute-endpoint.md    | implemented | handleSetupExecute() in api.go         |
| 2026-03-20-funnel-gap-logging.md        | implemented | 7 funnel events merged (#2161)         |
| 2026-03-23-event-coalescing.md          | implemented | EventCoalescer.ts exists; #2179 merged |

### docs/superpowers/specs/ (3 files)

| File                                           | Status      | Evidence                             |
| ---------------------------------------------- | ----------- | ------------------------------------ |
| 2026-03-17-git-recovery-coordination-design.md | implemented | Spec complete; implementation merged |
| 2026-03-17-setup-execute-endpoint-design.md    | implemented | Go handler implemented and tested    |
| 2026-03-20-funnel-gap-logging-design.md        | implemented | 7 events implemented and merged      |

**Summary:** 31 implemented, 6 active, 2 superseded, 8 not-implemented, 2 are this plan + its predecessor.

---

## Appendix B: ai-lib Unified Provider API Reference

Use this reference when rewriting ai-lib docs in Unit 4.

### Core Import

```typescript
import {
  getModel,
  getEmbeddingModel,
  getAvailableModels,
  isModelSupported,
} from "@airo/ai-lib";
```

### `getModel(modelName: string, config?: ProviderConfig): Promise<LanguageModel>`

Auto-routes to OpenAI, Bedrock, or Anthropic based on credentials.

```typescript
const model = await getModel("gpt4o");
const claude = await getModel("sonnet4");
const haiku = await getModel("haiku");
```

### Valid Model Short Names

**Claude:** `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-sonnet-4` (alias: `sonnet4`, `claude4`), `claude-haiku-4-5`, `claude-3-5-sonnet`, `claude-3-5-haiku`, `claude-3-haiku`

**OpenAI:** `gpt-4o` (alias: `gpt4o`), `gpt-4o-mini` (alias: `gpt4o-mini`), `gpt-4` (alias: `gpt4`), `gpt-4-turbo`, `gpt-3.5-turbo` (alias: `gpt35`)

**Gemini:** `gemini-3-flash-preview` (alias: `gemini3-flash`), `gemini-3-pro-preview` (alias: `gemini3-pro`)

**Embedding:** `titan-embed-v2`, `titan-embed-v1`, `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-ada-002`, `cohere-embed-english`, `cohere-embed-multilingual`

### Delegation Tools

```typescript
import { createDelegateTool, addDelegationTools } from "@airo/ai-lib";

const delegateTool = createDelegateTool(factory, "my-agent-id");
```

### Removed Exports (Do NOT Reference in Docs)

- `openAIModels` — removed, use `getModel()` with short names
- `bedrockModels` — removed, use `getModel()` with short names
- `openAIModels.gpt4oMini()` → `getModel('gpt4o-mini')`
- `bedrockModels.claudeSonnet4()` → `getModel('sonnet4')`
- `createHandoffTool` — renamed to `createDelegateTool`

### ProviderConfig Interface

```typescript
interface ProviderConfig {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  awsProfile?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  s2sAuth?: S2SAuthConfig;
  blockedAnthropicBetaHeaders?: string[];
}
```

---

## Appendix C: Pre-Drafted docs/README.md Index

Use this as the starting point for Unit 9a. Verify links after Unit 1 deletions.

```markdown
# Documentation Index

> **Note:** The `thought-exercise/` directory contains exploratory documents and does not reflect the current architecture. See root CLAUDE.md for the actual system design.

## Architecture

- [unified-nomad-job-architecture.md](unified-nomad-job-architecture.md) — Single Nomad job consolidation for preview and publish
- [client-websocket-architecture.md](client-websocket-architecture.md) — WebSocket state machine and client-server coordination
- [persistent-storage-architecture.md](persistent-storage-architecture.md) — Ceph filesystem architecture for app persistence
- [git-operations-architecture.md](git-operations-architecture.md) — Git workflow isolation and LLM interaction tracking
- [stop-and-queue-architecture.md](stop-and-queue-architecture.md) — User-controlled agent stream stopping and message queuing
- [prompt-caching-architecture.md](prompt-caching-architecture.md) — Anthropic prompt caching strategy
- [video-generation-architecture.md](video-generation-architecture.md) — WebSocket-based async video generation
- [website-rebuild-data-flows.md](website-rebuild-data-flows.md) — Data flow for website scraping and rebuild
- [publish-archive-strategy.md](publish-archive-strategy.md) — AAB vs PaaS archive strategy detection
- [frontend-aws-architecture.md](frontend-aws-architecture.md) — Next.js frontend on AWS infrastructure
- [onprem-hosting-architecture.md](onprem-hosting-architecture.md) — On-premises hosting using Nomad and Cilium

## Security

- [cors-security-guide.md](cors-security-guide.md) — CORS configuration and verification
- [cors-audit-summary.md](cors-audit-summary.md) — CORS audit results
- [app-transfer-security.md](app-transfer-security.md) — Token-based app ownership transfer
- [preview-app-authentication.md](preview-app-authentication.md) — Cross-domain JWT for preview apps
- [image_security.md](image_security.md) — External image URL blocking
- [oauth-architecture.md](oauth-architecture.md) — OAuth PKCE and client credentials flows
- [ui-agents-authentication-architecture.md](ui-agents-authentication-architecture.md) — JWT auth between UI and agents

## Operations

- [OPERATIONAL_PLAYBOOK.md](OPERATIONAL_PLAYBOOK.md) — On-call runbook, alerts, dashboards
- [LOCAL_APM_SETUP.md](LOCAL_APM_SETUP.md) — Local Elastic APM stack for dev
- [REQUEST_CONTEXT_GUIDE.md](REQUEST_CONTEXT_GUIDE.md) — AsyncLocalStorage request context for logging

## Features

- [CLIENT-SIDE-TOOLS.md](CLIENT-SIDE-TOOLS.md) — Browser-side tool execution via WebSocket
- [mediasearch.md](mediasearch.md) — Getty Images media search integration
- [knowb-knowledge-base.md](knowb-knowledge-base.md) — KnowB RAG service configuration
- [site-publish-doc.md](site-publish-doc.md) — Publish workflow via StepFunctions
- [design-agent-design.md](design-agent-design.md) — Design agent architecture
- [design-agent-examples.md](design-agent-examples.md) — Design agent usage examples
- [design-agent-summary.md](design-agent-summary.md) — Design agent overview
- [manual-recovery-analysis.md](manual-recovery-analysis.md) — Manual recovery flow safety
- [commerce-cart-cache-issue.md](commerce-cart-cache-issue.md) — Known cart caching issue
- [agent-tool-inventory.md](agent-tool-inventory.md) — Agent tool and service inventory

## PaaS

- [paas/github-sync-design.md](paas/github-sync-design.md) — Bidirectional GitHub sync
- [paas/github-sync-class-diagram.md](paas/github-sync-class-diagram.md) — GitHub sync component diagram
- [paas/paas-customer-logs-access.md](paas/paas-customer-logs-access.md) — Customer deployment log visibility
- [paas/zip-import-architecture.md](paas/zip-import-architecture.md) — Code import via zip upload
- [paas/zip-import-plan.md](paas/zip-import-plan.md) — Zip import design decisions

## Skills

- [skills/stripe-skill.md](skills/stripe-skill.md) — Stripe payment integration
- [skills/online-appointments-skill.md](skills/online-appointments-skill.md) — Online appointment booking

## Social

- [social/social-connections-diagrams.md](social/social-connections-diagrams.md) — Social media connection flows

## Tech Debt

- [tech-debt/summarization-improvements.md](tech-debt/summarization-improvements.md) — Conversation summarization improvements

## Plans

See individual files for `status:` frontmatter (implemented, active, superseded, not-implemented).

### Core Plans

- [plans/](plans/) — 35 feature and refactor plans

### PaaS Plans

- [paas/plans/](paas/plans/) — 6 PaaS-specific plans

### Superpowers Plans & Specs

- [superpowers/plans/](superpowers/plans/) — 4 implementation plans
- [superpowers/specs/](superpowers/specs/) — 3 design specs

## Brainstorms

- [brainstorms/2026-03-20-runtime-perf-quick-wins-requirements.md](brainstorms/2026-03-20-runtime-perf-quick-wins-requirements.md) — Runtime performance quick wins
- [brainstorms/2026-03-25-aws-credential-auto-refresh-requirements.md](brainstorms/2026-03-25-aws-credential-auto-refresh-requirements.md) — AWS credential auto-refresh

## Ideation

- [ideation/2026-03-25-open-ideation.md](ideation/2026-03-25-open-ideation.md) — Ranked improvement ideas

## Solutions

- [solutions/developer-experience/aws-profile-credential-auto-resolution.md](solutions/developer-experience/aws-profile-credential-auto-resolution.md) — AWS SSO credential auto-resolution

## Thought Exercise (Exploratory)

> These documents explore potential future capabilities. They are not committed designs.

- [thought-exercise/platform-architecture.md](thought-exercise/platform-architecture.md) — Platform microservices concepts
- [thought-exercise/agent-features.md](thought-exercise/agent-features.md) — Specialized AI agent suite
- [thought-exercise/ai-features.md](thought-exercise/ai-features.md) — Managed AI capabilities
- [thought-exercise/architecture-diagrams.md](thought-exercise/architecture-diagrams.md) — Architecture diagrams
- [thought-exercise/development-features.md](thought-exercise/development-features.md) — Standardized tech stack
- [thought-exercise/hosting-features.md](thought-exercise/hosting-features.md) — Enterprise hosting features
- [thought-exercise/security-features.md](thought-exercise/security-features.md) — AI security analyst
- [thought-exercise/tech-stack.md](thought-exercise/tech-stack.md) — Tech stack philosophy

## Archived

> These docs have been superseded. See root CLAUDE.md for current architecture.

- [overview.md](overview.md) — Original platform overview (archived)
- [ai-hosting-platform-docs.md](ai-hosting-platform-docs.md) — AI hosting platform docs (archived)
```

---

## Appendix D: Pre-Investigated Broken References by File

Detailed per-file findings from deepening round 3 (2026-03-26). Use during implementation to avoid re-researching.

### Unit 7: dev-supervisor (10 inaccuracies)

| File           | Line(s) | Issue                                   | Fix                                                                                                                                           |
| -------------- | ------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| README.md      | 91      | Go 1.21                                 | → 1.25 (go.mod: 1.25, Makefile: 1.25.7)                                                                                                       |
| README.md      | 272-277 | `main.go`, `api.go`, etc. shown at root | Move under `cmd/dev-supervisor/`                                                                                                              |
| README.md      | 286-289 | Test files shown at root                | Move under `cmd/dev-supervisor/` (11 test files)                                                                                              |
| README.md      | 268-302 | Missing dirs                            | Add `cmd/`, `cmd/airo-sandbox/`, `examples/`, `internal/allocconfig/`, `internal/middleware/`, `internal/validation/`, `internal/proxy/http/` |
| DEVELOPMENT.md | 21      | Go 1.21                                 | → 1.25                                                                                                                                        |
| DEVELOPMENT.md | 104     | `pid1_manager*.go`                      | → `internal/process/manager*.go`                                                                                                              |
| DEVELOPMENT.md | 168     | `pid1_orphan_reaper_linux.go`           | → `internal/process/reaper_linux.go`                                                                                                          |
| DEVELOPMENT.md | 173     | `pid1_manager_unix.go`                  | → `internal/process/manager_unix.go`                                                                                                          |
| DEVELOPMENT.md | 259     | `pid1_linux_test.go`                    | → `internal/processmanager/pid1_linux_test.go`                                                                                                |
| CLAUDE.md      | 66-89   | Missing 2 packages                      | Add `internal/allocconfig/`, `internal/middleware/`                                                                                           |

SANDBOX.md: All "planned" items confirmed still planned (no sandbox env vars in config.go, no sandbox code in command_executor.go). No changes needed.

### Unit 9b: airo-supervisor instances (21+ in docs/)

| File                                      | Instances | Key locations                                                                                                   |
| ----------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `docs/unified-nomad-job-architecture.md`  | 4         | Lines 62, 101, 487, 544                                                                                         |
| `docs/persistent-storage-architecture.md` | 1         | Line 349                                                                                                        |
| `docs/onprem-hosting-architecture.md`     | 16+       | Section headers (143, 147), mermaid diagrams (156-157), socket paths (163, 285, 290), security model (301, 303) |
| **Out of scope (code files)**             | 5 files   | `.gitignore`, `config.go`, `main.go`, `docker-integration-tests.sh`, `nomad_setup_and_serve.sh`                 |

### Unit 10: agents/ broken references

| File                           | Line(s)        | Broken Reference                                                                              | Fix                                      |
| ------------------------------ | -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `skills/README.md`             | 249            | Lists 2 skills                                                                                | List all 15 (see Unit 10 approach)       |
| `CONTEXT_DEBUGGING_GUIDE.md`   | 37             | `conversation-websocket-wrapper.ts`                                                           | → `ai-lib-websocket-server.ts` (verify)  |
| `docs/SUMMARIZATION.md`        | 63-69, 149-154 | `FileEditCompressionStrategy`, `FileEditInputCompressionStrategy`, `HotFileInclusionStrategy` | Remove; replace with actual 8 strategies |
| `docs/rag-search-tool.md`      | 351-355        | `./qdrant-service.md`, `./memory-tool.md`, `./design-agent.md`                                | Remove (files don't exist)               |
| `docs/knowb-search.md`         | 215            | `./mediasearch.md`                                                                            | Remove dead link                         |
| `docs/knowb-search.md`         | 217            | `../src/tools/rag-tool.ts`                                                                    | → `./rag-search-tool.md`                 |
| `docs/website-scraper-tool.md` | multiple       | `.js` extensions                                                                              | → `.ts`                                  |
| `AI_SDK_DEVTOOLS.md`           | —              | No issues found                                                                               | Skip                                     |

### Unit 11: app/ and root broken references

| File                       | Line(s)        | Issue                                                 | Fix                                   |
| -------------------------- | -------------- | ----------------------------------------------------- | ------------------------------------- |
| `mgmt-airo/README.md`      | 197-205        | Migration section may conflict with V2_INTEGRATION.md | Reconcile; mark as historical if done |
| `tool-renderers/README.md` | 221-237        | Phase 2 features not marked as planned                | Add "Planned (Phase 2)" header        |
| `app/README.md`            | 388-389        | `/tmp/apps` reference                                 | Clarify local vs V2                   |
| `V2_INTEGRATION.md`        | 540, 1046      | `control-plane/factory.ts`                            | Verify; may be `adapter-factory.ts`   |
| `GETTING_STARTED.md`       | 388-389        | `/tmp/apps`                                           | → `/tmp/airo-app-builder/{appId}/`    |
| `LOGGING-GUIDE.md`         | 78-81, 186-191 | `templateVersion: 'v3'`                               | → `v8`; add no-emoji rule             |
| `changelog.md`             | 3              | "Next Release target 2025-10-01"                      | Update (6 months past)                |

---

## Appendix E: Pre-Investigated Unit Findings (Round 4)

### Unit 1: Root-level PLAN files — all implemented

| File                                          | Status      | Key Evidence                                                                                                                                                                                                              |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAN-git-commit-hash-in-complete-message.md` | implemented | `handleConnectionEnd()` returns `commitHash` (git-hook-service.ts:416), `beforeMessageComplete` callback wired (ai-lib-websocket-server.ts:1563-1606)                                                                     |
| `PLAN-waf-prompt-validation.md`               | implemented | `waf-validation.ts` created with `getByteLength()`, `truncateToByteLimit()`, `validateAndClampPrompt()`; applied in `HeroSection.tsx:64,275,368`; server-side in `quick-create/route.ts:52`; tests passing                |
| `TODO_LIST_TOOL.md`                           | implemented | `TodoListRepository` (schema with `todo_lists` + `todo_items` tables), `todo-list-tool.ts`, `ai-lib-tools/todo-list.ts`, 11 tests passing, all 9 operations (create/get/list/delete lists + add/update/delete/mark items) |

### Unit 2: Root CLAUDE.md — exact fixes

| Item                           | Current                     | Fix                                                                                                |
| ------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------- |
| Env path                       | `app/.env.example`          | → `app/.env` (no .example suffix exists)                                                           |
| Services table                 | Missing local-control-plane | Add row: `\| local-control-plane/ \| Go binary \| 4100 \| Local mgmt-airo API, SQLite + Docker \|` |
| CLAUDE.md file list (line 53)  | 3 services                  | Add `[local-control-plane/](local-control-plane/CLAUDE.md)`                                        |
| Additional Documentation links | 7 links                     | All 7 verified correct — no changes needed                                                         |

### Unit 3: agents/CLAUDE.md — complete diffs

**Tables** (schema.ts has 13, CLAUDE.md has 7):

- Add: `running_processes`, `memory`, `import_jobs`, `conversation_summaries`, `share_tokens`, `social_associations`, `social_posts`
- Remove: `token_usage`

**Agents** (8 files, CLAUDE.md lists 5):

- Add: `PagePromptAgent`, `SiteAnalyzerAgent`, `ExampleAgent`
- Remove: `CommerceAgent` (skill, not agent)

**Tools**: 44 actual (CLAUDE.md says ~50)

**Prompt dirs** (10 actual, CLAUDE.md lists 3):

- Add: `design/`, `initial/`, `example/`, `marketing/`, `color-scheme/`, `font-tool/`

**Skills** (16 dirs, CLAUDE.md lists 0):

- Add reference or list

### Unit 4: ai-lib docs — 40+ broken references

**INTEGRATION_GUIDE.md** (heaviest — near-complete rewrite needed):

- 50+ instances of `openaiModels.*()` / `bedrockModels.*()` → `getModel()`
- `Agent` class → `AgentWrapper`
- `new Agent({...})` → `agentFactory.defineAgents()`

**delegation-and-handoff.md** (6 broken refs):

- `createHandoffHelpers` → `createInMemoryHandoffStateManager`
- `createHandoffTool` signature wrong (has `agents` param that doesn't exist)
- `createHandoffLogger`, `createHandoffValidator` not exported
- Dead links to `agent-factory.md`, `tools.md`

**handoff-state-manager.md** (10 non-existent methods):

- `getOrCreateSession`, `getSessionHistory`, `getActiveSessions`, `getSessionCount`, `getStats`, `clearAllSessions`, `stopCleanup` — all non-existent
- `switchAgent` param `reason` → `prompt`

### Unit 5: README.md — all 12 broken links mapped

| Line | Current Target                       | Fix                                                  |
| ---- | ------------------------------------ | ---------------------------------------------------- |
| 74   | `./docs/platform-architecture.md`    | → `./docs/thought-exercise/platform-architecture.md` |
| 75   | `./docs/hosting-architecture.md`     | Remove (file doesn't exist anywhere)                 |
| 76   | `./docs/architecture-diagrams.md`    | → `./docs/thought-exercise/architecture-diagrams.md` |
| 80   | `./docs/tech-stack.md`               | → `./docs/thought-exercise/tech-stack.md`            |
| 81   | `./docs/development-features.md`     | → `./docs/thought-exercise/development-features.md`  |
| 85   | `./docs/agent-features.md`           | → `./docs/thought-exercise/agent-features.md`        |
| 86   | `./docs/ai-features.md`              | → `./docs/thought-exercise/ai-features.md`           |
| 87   | `./docs/image-search-feature.md`     | Remove (no file exists)                              |
| 88   | `./docs/image-generation-feature.md` | Remove (no file exists)                              |
| 89   | `./docs/getty-images-feature.md`     | Remove (no file exists)                              |
| 90   | `./docs/hosting-features.md`         | → `./docs/thought-exercise/hosting-features.md`      |
| 91   | `./docs/security-features.md`        | → `./docs/thought-exercise/security-features.md`     |
