# debug-console

Internal Next.js + Express dashboard the dev/support teams uses to inspect agent traces, app context, and Loki/ES logs. **Not customer-facing.**

## Audience & Operational Context

- **Users:** Airo Builder dev team only (~100–200 engineers, 10-20 leaders)
- **Deployment:** Internal cluster behind GoDaddy SSO
- **SLAs:** 99% availability, Tier 3 service. No on-call rotation, no PagerDuty, no customer impact when this is down or degraded
- **Failure mode:** Support teams are impacted and it can impact their SLAs

This context determines the review rigor bar (see below). Production customer-facing services (`agents/`, `app/`, `dev-supervisor/`) follow stricter standards documented in their own CLAUDE.md.

## Architecture

- `src/app/api/` — Next.js App Router routes (support-bundle, screenshots, app-context, etc.)
- `src/lib/analytics/` — Scheduler that pulls events from Loki (and Katana app errors from a separate ES cluster) into the local airobuilde ES index for dashboards
- `src/lib/loki-client.ts` — Loki query helper used across the app
- `src/app/`, `src/components/` — UI (Next.js App Router)

## Key Commands

```bash
pnpm --filter debug-console dev          # Local dev (port from server.ts)
pnpm --filter debug-console typecheck
pnpm --filter debug-console test
pnpm --filter debug-console lint
```

## Review Rigor

**Apply pragmatic review.** This is an internal tool with lite SLA — perfect-world observability and exhaustive edge-case coverage are not required.

### Worth flagging

- Correctness bugs that would corrupt data or break the dashboard
- Security issues (auth bypass, injection, secret leaks)
- Bugs that would silently lose data with no operator-visible signal at all
- Tests that pass when the implementation is broken (false positives)
- Genuinely confusing code that a future maintainer would misread

### Not worth flagging

- Logger event name format nits (two-segment vs three-segment, snake_case vs camelCase fields) — pick one shape and move on
- "Distinct event names for similar errors" so dashboards/alerting can disambiguate — there is no alerting on this service
- Double-log prevention flags / `errorAlreadyLogged` patterns — extra log lines are fine
- Exhaustive switch-arm tests for analytics dispatch (one canonical case per group is enough)
- `cause` chains on wrapped errors — original `Error` is fine
- Sentinel-string fallbacks like `<body read failed>` to disambiguate transient failure modes — `''` is fine
- Tests for every `try/catch` branch when the catch just logs and moves on
- Hypothetical-regression tests (testing catch blocks for bugs that don't exist yet) — code review would catch the regression
- Comments explaining "why this could fail" beyond a one-line note
- Re-running the review pipeline against fix commits to surface successively smaller issues
