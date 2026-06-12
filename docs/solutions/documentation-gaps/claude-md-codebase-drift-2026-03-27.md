---
title: "Documentation silently drifted from actual codebase state"
date: 2026-03-27
last_updated: 2026-03-30
problem_type: documentation_gap
component: documentation
root_cause: inadequate_documentation
resolution_type: documentation_update
severity: medium
module:
  - agents/CLAUDE.md
  - CLAUDE.md
  - dev-supervisor/CLAUDE.md
  - packages/ai-lib/docs
tags:
  - claude-md
  - documentation-drift
  - code-review
  - agent-definitions
  - database-schema
  - tooling-inventory
  - ai-lib
  - api-drift
  - naming-inconsistency
files_modified:
  - agents/CLAUDE.md
  - CLAUDE.md
  - dev-supervisor/CLAUDE.md
  - local-control-plane/CLAUDE.md
  - packages/ai-lib/docs/handoff-state-manager.md
  - packages/ai-lib/docs/delegation-and-handoff.md
  - agents/CONTEXT_DEBUGGING_GUIDE.md
category: documentation-gaps
---

# Documentation Silently Drifted from Codebase State

## Problem

Documentation across the monorepo silently drifted from the actual codebase over months. CLAUDE.md files listed agents that no longer exist, under-counted database tables (7 listed vs 15 actual), and omitted entire services. ai-lib docs referenced deprecated functions (`createInMemoryHandoffStateManager` instead of `createSessionStateManager`), used wrong parameter names (`reason` instead of `prompt`), and contained emoji in debug examples that violated the project's logging policy. These files are the primary context LLMs consume when working on this codebase, so stale data leads to incorrect assumptions and wasted cycles.

## Symptoms

- LLMs reference agents, tables, or tools that don't exist (e.g., CommerceAgent, `token_usage` table)
- LLMs fail to use capabilities that do exist (e.g., PagePromptAgent, `memory` table, `requestSecrets` stop-after tool)
- Counts in docs contradict what `ls` or `grep` reveal
- Services table omits services entirely (local-control-plane was missing)
- Directory trees are incomplete, causing incorrect assumptions about where code lives
- ai-lib docs reference deprecated `createInMemoryHandoffStateManager` instead of current `createSessionStateManager`
- `onAgentSwitch` callback documented as `reason?: string` but public API uses `prompt`
- Debug guide (`CONTEXT_DEBUGGING_GUIDE.md`) uses emoji in console.log snippets, contradicting no-emoji logging policy

### Specific Drift Found

| File | What Drifted | Listed | Actual |
|------|-------------|--------|--------|
| agents/CLAUDE.md | Agents | 5 + CommerceAgent | 7 (no CommerceAgent) |
| agents/CLAUDE.md | DB tables | 7 | 15 |
| agents/CLAUDE.md | Tool count | ~50 | 44 |
| agents/CLAUDE.md | Stop-after tools | 3 | 4 (missing requestSecrets) |
| agents/CLAUDE.md | Handoff targets | marketing, commerce | marketing only |
| agents/CLAUDE.md | Skills | 2 | 16 |
| agents/CLAUDE.md | Prompt dirs | 2 | 9 |
| CLAUDE.md | Services table | 6 services | 7 (missing local-control-plane) |
| dev-supervisor/CLAUDE.md | Dir tree | stale | missing allocconfig/, middleware/ |
| ai-lib handoff-state-manager.md | Factory function | `createInMemoryHandoffStateManager` | `createSessionStateManager` (old is `@deprecated` at line 708) |
| ai-lib handoff-state-manager.md | `onAgentSwitch` callback param | `reason?: string` | `prompt?: string` (matches `switchAgent` and `createHandoffTool`) |
| ai-lib handoff-state-manager.md | Opening line | listed both names (duplicate) | single `createSessionStateManager` |
| ai-lib delegation-and-handoff.md | Implementation ref | `createInMemoryHandoffStateManager` | `createSessionStateManager` |
| CONTEXT_DEBUGGING_GUIDE.md | console.log prefixes | emoji (📸, 📤, 📋, etc.) | hierarchical event names (`context.capture`, `llm.call`, etc.) |

## What Didn't Work

- **Trusting docs at face value.** No one cross-checked CLAUDE.md against source files during feature development.
- **Relying on PR review to catch drift.** When a PR adds a new agent or DB table, reviewers focus on code — they don't check whether an unrelated CLAUDE.md inventory needs updating.
- **Hardcoded counts.** Stating "~50 tools" or listing exactly 5 agents creates a snapshot that becomes wrong with the next merge.
- **One-time documentation efforts.** CLAUDE.md was written once then left to rot. Without recurring audits, drift is inevitable.
- **Automated reviewer false positives.** The copilot-pull-request-reviewer bot claimed `delegation-and-handoff.md:22` still used the deprecated name when it already said `createSessionStateManager`. CI bot reviewed a stale commit state and flagged issues already fixed in the working tree. Bot claims must be verified against actual file state before acting on them.
- **Source code naming inconsistency masked by docs.** The `reason`/`prompt` mismatch exists in the source itself: `handoff-state-manager.ts:105` declares `onAgentSwitch(..., reason?)`, and `SessionState.history` at line 81 types the field as `reason`, but `switchAgent` at line 189 pushes `{ prompt }` via spread. The `reason` field in history entries is never actually populated. TypeScript doesn't catch this because the spread bypasses strict object literal checks.

## Solution

Structured manual audit of every CLAUDE.md section against source code:

**Step 1 — Identify auditable sections.** Catalog each CLAUDE.md section referencing countable things: agent lists, DB tables, tool counts, prompt directories, skills, services, directory trees.

**Step 2 — Cross-reference against source of truth.**

```bash
# Agents
ls agents/src/agents/*.ts

# DB tables
ls agents/src/database/repositories/

# Tools
grep -c '' <<< "$(grep '^\s\+\w.*:' agents/src/tools/ai-lib-tools/index.ts)"

# Skills
ls agents/src/skills/

# Prompt dirs
ls agents/src/prompts/

# Stop-after tools
grep -A5 'stopAfterTools' agents/src/agents/ai-lib-agents/index.ts

# Handoff targets
grep -A5 'handoff' agents/src/agents/develop-agent.ts
```

**Step 3 — Update docs to match reality.** Replace stale values. Remove references to things that no longer exist. Add references to missing items.

**Step 4 — Verify via diff.** `git diff` each file to confirm changes are corrections, not accidental content removals.

**For API-level doc drift (ai-lib, etc.):**

```bash
# Find deprecated functions still referenced in docs
grep -rn 'createInMemoryHandoffStateManager' packages/ai-lib/docs/

# Cross-check doc parameter names against source interfaces
grep -A5 'onAgentSwitch' packages/ai-lib/src/tools/handoff-state-manager.ts
# Compare with doc version to verify match

# Check for emoji in files that should follow logging policy
grep -Pn '[\x{1F300}-\x{1F9FF}]' agents/**/*.md
```

## Why This Works

CLAUDE.md files contain **derived data** (counts, inventories, directory listings) that duplicates information from source code, with no mechanism to stay in sync. Unlike code, documentation has no automated validation — it doesn't fail to compile when inconsistent. The problem compounds because:

1. CLAUDE.md is not in the critical path of any feature PR
2. Precise numbers and exhaustive enumerations become wrong the moment a single item changes
3. LLMs treat CLAUDE.md as authoritative, so stale data has real downstream costs

## Prevention

**PR checklist item.** Add to the existing PR checklist: "If you added/removed an agent, tool, skill, DB table, or service, update the corresponding CLAUDE.md inventory." This is the most effective prevention — catches drift at the point of introduction.

**Prefer source references over exact counts.** Instead of "44 tools", say "Tools registered in `src/tools/ai-lib-tools/index.ts` (`allAILibTools`)" and let the reader check the source. Reserve exact enumerations for things that rarely change (services, agents).

**Periodic audits.** Quarterly review of all CLAUDE.md files against the checklist:
- [ ] Agent list matches `ls agents/src/agents/*.ts`
- [ ] DB table list matches `src/database/repositories/`
- [ ] Tool count matches `allAILibTools` array length
- [ ] Skills list matches `ls agents/src/skills/`
- [ ] Services table matches top-level service directories
- [ ] Directory trees match `ls` output
- [ ] All file paths referenced actually exist

**Scope CLAUDE.md to stable architecture, not volatile inventories.** The most valuable parts are architectural patterns (dual-product pattern, prompt composition design), not item lists. Consider referencing source directories ("see `src/skills/` for current list") instead of duplicating inventories.

**When deprecating a function, update docs in the same PR.** The commit that added `@deprecated` to `createInMemoryHandoffStateManager` should have also updated `delegation-and-handoff.md` and `handoff-state-manager.md`. Same applies to parameter renames.

**Verify automated reviewer claims against actual file state.** Bot reviewers (copilot, CI) can hallucinate or review stale commits. Always `cat` the file before acting on a bot suggestion.

**When bulk find-and-replacing, check for duplicates.** A find-and-replace that turns "created via `createInMemoryHandoffStateManager` or `createSessionStateManager`" into "created via `createSessionStateManager` or `createSessionStateManager`" is easy to miss in a large diff. Run `grep -Pn '\b(\w+)\s+or\s+\1\b'` after bulk renames.

**When updating style rules, grep for existing violations.** Adding "no emoji in logs" to `LOGGING-GUIDE.md` should include a grep for emoji in existing log/debug files and fix them in the same PR.

## Related

- PR: [#2303](https://github.com/gdcorp-partners/airo-app-builder/pull/2303) -- documentation cleanup that surfaced this drift
- Source code bug (unresolved): `handoff-state-manager.ts:81` types history field as `reason` but line 189 pushes `{ prompt }` — the `reason` field is never populated
- Source code bug (unresolved): `handoff-state-manager.ts:105` `onAgentSwitch` callback uses `reason` but receives `prompt` value at line 210
