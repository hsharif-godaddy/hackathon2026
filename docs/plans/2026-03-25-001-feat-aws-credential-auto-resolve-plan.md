---
title: "feat: auto-resolve AWS SSO credentials in agents load-env"
type: feat
status: implemented
date: 2026-03-25
origin: docs/brainstorms/2026-03-25-aws-credential-auto-refresh-requirements.md
---

# feat: auto-resolve AWS SSO credentials in agents load-env

## Overview

Replace the `AWS_PROFILE` rejection in `agents/load-env.cjs` with automatic credential resolution via `aws configure export-credentials`. Developers run `aws sso login` once per day and `pnpm dev` auto-resolves Bedrock credentials at startup.

## Problem Frame

`setup/` generates `.env.local.dev` with `AWS_PROFILE=airobuild-dev-private-sso`, but `agents/load-env.cjs:101-105` rejects `AWS_PROFILE` and exits. This forces a manual `aws configure export-credentials ... > agents/.env.local` workaround every ~4 hours. (see origin: docs/brainstorms/2026-03-25-aws-credential-auto-refresh-requirements.md)

## Requirements Trace

- R1. Detect `AWS_PROFILE` in env vars, resolve to raw creds via `aws configure export-credentials`
- R2. Inject resolved creds into process.env, remove `AWS_PROFILE`, spawn child with resolved creds
- R3. Actionable errors for: SSO expired, CLI not found, profile not configured
- R4. Setup-generated `.env.local.dev` files work end-to-end
- R5. Skip resolution when `AWS_ACCESS_KEY_ID` already present

## Scope Boundaries

- Agents-only. `scripts/load-env.js` (app) already handles `AWS_PROFILE` correctly.
- Startup-only resolution. Mid-session expiry requires restart.
- No new dependencies. Uses `child_process.execFileSync` (already available in load-env.cjs).

## Context & Research

### Relevant Code and Patterns

- `agents/load-env.cjs:99-106` — current `validateEnvironment()` that rejects `AWS_PROFILE`. This is the function to replace.
- `scripts/load-env.js:96-143` — reference implementation. App's load-env validates SSO session via `execFileSync('aws', ['sts', 'get-caller-identity', ...])` with proper error handling for CLI-not-found vs SSO-expired. Follow this error handling pattern.
- `agents/load-env.cjs:111-227` — `validateGoCodeKey()` async function. Shows existing validation chain pattern (`validateEnvironment().then(validateGoCodeKey).then(spawnChildProcess)`).
- `agents/.env:17` — `AWS_REGION=us-west-2` loaded in base defaults. Region preserved because credential resolution only injects `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`.

## Key Technical Decisions

- **Use `execFileSync` not `execSync`**: Matches `scripts/load-env.js` pattern, avoids shell injection. `execFileSync('aws', ['configure', 'export-credentials', '--profile', profile, '--format', 'env-no-export'])`.
- **Parse env-no-export format**: Output is `KEY=VALUE\n` lines. Split on newlines, split each on first `=`, inject into `process.env`.
- **Delete `AWS_PROFILE` after resolution**: Prevents downstream SDK confusion. The resolved raw creds are sufficient.
- **Timeout of 5 seconds**: Matches `scripts/load-env.js:109` timeout pattern for AWS CLI calls.

## Open Questions

### Resolved During Planning

- **Does `aws configure export-credentials` include AWS_REGION?** No. Only outputs `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`. `AWS_REGION` is preserved from `agents/.env` (loaded earlier in the dotenv chain).

### Deferred to Implementation

- **Exact stderr content from `aws configure export-credentials` on SSO expiry**: May differ from `sts get-caller-identity` errors. Handle conservatively — if command fails and it's not ENOENT, assume SSO issue and show login instructions.

## Implementation Units

- [ ] **Unit 1: Replace AWS_PROFILE rejection with credential resolution**

**Goal:** Replace `validateEnvironment()` so it resolves `AWS_PROFILE` to raw credentials instead of rejecting it.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `agents/load-env.cjs`
- Test: manual verification (see Verification below)

**Approach:**
- Replace `validateEnvironment()` (lines 99-106) with `resolveAwsCredentials()`
- Early return if `AWS_ACCESS_KEY_ID` already in process.env (R5 — raw creds take precedence)
- Early return if no `AWS_PROFILE` in process.env (no profile to resolve)
- Call `execFileSync('aws', ['configure', 'export-credentials', '--profile', process.env.AWS_PROFILE, '--format', 'env-no-export'], { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 })`
- Parse output: split on `\n`, for each non-empty line split on first `=`, set `process.env[key] = value`
- Delete `process.env.AWS_PROFILE`
- Log success: `"Resolved AWS credentials from profile <name>"`
- Error handling (three cases per R3, following `scripts/load-env.js:112-141` pattern):
  - `error.code === 'ENOENT'`: AWS CLI not installed. Show install link.
  - Otherwise: SSO session expired or profile not found. Show `aws sso login --profile <profile>`. Include `error.stderr` for debug context.

**Patterns to follow:**
- `scripts/load-env.js:96-143` — error handling structure, `execFileSync` usage, timeout, console output formatting
- `agents/load-env.cjs:159-227` — existing `validateGoCodeKey()` for console message style and exit patterns

**Test scenarios:**
- `AWS_ACCESS_KEY_ID` already set in `.env.local` -> skips profile resolution, passes through
- `AWS_PROFILE` set, SSO session active -> resolves creds, removes `AWS_PROFILE`, child starts with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`
- `AWS_PROFILE` set, SSO session expired -> actionable error with `aws sso login` command, exit 1
- `aws` CLI not installed -> error with install instructions, exit 1
- Neither `AWS_PROFILE` nor `AWS_ACCESS_KEY_ID` set -> passes through (non-Bedrock provider)
- `AWS_REGION` preserved from `.env` after credential resolution

**Verification:**
- `aws sso login --profile airobuild-dev-private-sso` then `pnpm --filter @airo/agents run dev` starts without errors
- Agent can make Bedrock API calls (send a message in the UI)
- Removing `.env.local` (raw creds file) still works because `.env.local.dev` has `AWS_PROFILE` which gets auto-resolved
- With expired SSO session, startup shows clear error with login command

## Risks & Dependencies

- **AWS CLI v2 required**: `aws configure export-credentials` was added in CLI v2. Setup already requires v2 for SSO, so this is not a new dependency.
- **SSO session must be active**: If developer's SSO session is fully expired (not just session tokens), they must `aws sso login` first. This is the same prerequisite as today, just surfaced with a better error message.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-25-aws-credential-auto-refresh-requirements.md](docs/brainstorms/2026-03-25-aws-credential-auto-refresh-requirements.md)
- Reference implementation: `scripts/load-env.js:96-143`
- Target file: `agents/load-env.cjs:99-106`
