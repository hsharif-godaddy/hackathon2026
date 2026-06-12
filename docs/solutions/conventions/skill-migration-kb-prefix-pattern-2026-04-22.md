---
title: Skill migration pattern with kb- prefix
date: 2026-04-22
category: conventions
module: claude-code-skills
problem_type: convention
component: tooling
severity: low
applies_when:
  - Moving skills from a notes/source repo to ~/.claude/skills/
  - Creating new custom skills for this project
  - Auditing existing skills against best practices
tags: [skills, claude-code, migration, conventions, kb-prefix]
---

# Skill migration pattern with kb- prefix

## Context

Custom skills were originally authored in a separate notes repo (`~/Documents/projects/notes/skills/`). To make them available globally in Claude Code, they need to live under `~/.claude/skills/`. A naming convention prevents collisions with community and plugin skills.

## Guidance

All custom skills must use the `kb-` prefix in both the directory name and the `name` frontmatter field.

Migration checklist per skill:

1. **Create target**: `mkdir -p ~/.claude/skills/kb-{name}/references/`
2. **Copy SKILL.md**: update `name:` to `kb-{name}`
3. **Copy reference files**: preserve executable bits on scripts (`chmod +x`)
4. **Apply improvements** (audit checklist below)
5. **Remove old location** if it was a duplicate (e.g., unprefixed `~/.claude/skills/{name}/` or `~/.claude/commands/{name}/`)

### Audit checklist (apply during migration)

- `disable-model-invocation: true` if the skill has side effects (posts comments, resolves threads, writes reports, opens browsers)
- `argument-hint:` present when the skill takes arguments
- `$ARGUMENTS` placeholder in the body (not `$0`)
- `allowed-tools:` lists specific tools needed
- No em dashes in any text
- Shell escaping guidance for `gh api` body fields (double quotes, escape backticks)
- UX: show drafts as regular text before AskUserQuestion (drafts inside the question field are invisible in terminal)
- Verify server-side code before posting comments about API contracts
- `model: "sonnet"` for scoped analysis subagents

## Why This Matters

- `kb-` prefix prevents name collisions with installed plugins and community skills
- Skills take precedence over commands with the same name, so migrating from `~/.claude/commands/` to `~/.claude/skills/` with a new prefix avoids shadowing
- Consistent improvements (disable-model-invocation, argument handling, shell escaping) prevent real-world failures discovered through usage

## When to Apply

- Creating any new custom skill
- Moving skills between locations
- Reviewing existing skills for quality

## Examples

Skills migrated in this session:

| Source | Target | Key improvements |
|--------|--------|-----------------|
| `notes/skills/pr-review-comments/` | `~/.claude/skills/kb-pr-review-comments/` | Fixed GitHub API (position vs line), added disable-model-invocation, shell escaping |
| `notes/skills/pr-defend/` | `~/.claude/skills/kb-pr-defend/` | Draft-before-question UX fix, verify-server-side in agent prompts, removed stale compound-engineering.local.md dependency |
| `notes/skills/resolve-claude-comments/` | `~/.claude/skills/kb-resolve-claude-comments/` | Confirmation before minimizing, model: sonnet for agents, unparseable-comments guard |
| `notes/skills/investigate-billing/` | `~/.claude/skills/kb-investigate-billing/` | Phase 2b browser demoted to optional (curl+jq 3x faster), removed auth token disk write, model: sonnet for agents |

## Related

- Memory: `feedback_skill-prefix.md` (all custom skills must be prefixed with "kb-")
- Memory: `feedback_pr-defend-drafts-hidden.md` (draft-before-question UX pattern)
- Memory: `feedback_verify-server-side.md` (verify handler code before commenting)
- Memory: `feedback_debug-console-cli.md` (curl+jq over playwright)
