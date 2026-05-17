# debug-console

Internal Next.js + Express dashboard the dev/support teams uses to inspect agent traces, app context, and Loki/ES logs. **Not customer-facing.**

## Audience & Operational Context

- **Users:** Airo Builder dev team only (~100–200 engineers, 10-20 leaders)
- **Deployment:** Internal cluster behind GoDaddy SSO
- **SLAs:** 99% availability, Tier 3 service. No on-call rotation, no PagerDuty, no customer impact when this is down or degraded
- **Failure mode:** Support teams are impacted and it can impact their SLAs

This context determines the review rigor bar (see below). Production customer-facing services (`agents/`, `app/`, `dev-supervisor/`) follow stricter standards documented in their own CLAUDE.md.

## Architecture

High-level only — read source for specifics.

```
Browser (Dashboard.tsx)  ── /api/* ──▶  Next.js routes  ── fetch ──▶  upstream APIs
                                                                        ├── Grafana → Loki  (agent / preview / publish logs)
                                                                        ├── ES (airobuilde, pioneermgt, traces-apm, llm_spend)
                                                                        ├── mgmt control plane (apps, subscriptions, image-status)
                                                                        ├── SSO (auth, AD groups)
                                                                        ├── Langfuse (traces / sessions)
                                                                        └── S3 (investigate events / reports, feedback, screenshots)
```

### Code layout

- `src/app/api/` — Next.js App Router routes. Heavy aggregators live here (`app-context`, `es-logs`, `support-bundle`, `investigate/*`).
- `src/lib/loki-client.ts` — low-level Loki query builder/runner.
- `src/lib/loki-merged.ts` — single-query helper covering `airo-agents` + `airo-preview` + `airo-publish` with cluster scoping; reused by Logs API and app-context.
- `src/lib/api-auth.ts` — `withAuth` wrapper + AD-group membership cache (60s TTL, coalesced).
- `src/lib/mgmt-control-plane-adapter.ts` — read-through cache (30s TTL) over mgmt-airo. `getAppDetails` always fetches the full version so lite callers reuse it.
- `src/lib/investigate/` — investigate flow (evidence collection across Loki/ES/Langfuse, S3-backed event log, SSE streaming).
- `src/lib/analytics/` — direct Loki/Katana queries powering the `/analytics` charts; the legacy ES-rollup scheduler was removed (see `analysis/` for research notes).
- `src/components/`, `src/pages/Dashboard.tsx` — UI. Tabs are lazy-mounted on first visit (`visitedTabs` set).
- `src/hooks/useAppContext.ts` — client-side cache + section-gated fetcher for `/api/app-context` (60s TTL, in-flight coalescing).

### Caching layers (top-to-bottom)

| Where | What | TTL | Why |
|---|---|---|---|
| `useAppContext` (client) | Whole `/api/app-context` response, keyed by `appId+timeRange+sections` | 60 s | Avoid refetching on tab switches and short navigations |
| `route-cache.ts` | Analytics endpoints (langfuse, c1, feedback, e2e-runs) | per-call | Spread heavy ES rollups across many concurrent users |
| `mgmt-control-plane-adapter.memoizeRead` | mgmt API reads | 30 s | One page load fans out to the same `apps/{id}` from multiple routes |
| `api-auth.fetchUserAdGroups` | SSO AD-group membership | 60 s | Every API request used to call SSO; one-per-token now |

Caches are in-process. Restarts purge them. Dev-only changes (e.g. heap snapshots) reset everything.

### Dev tooling

- `DEBUG_FETCH=1 pnpm dev` activates `dev-fetch-instrumentation.ts`, which monkey-patches `globalThis.fetch` to log every outbound call with timing, repeat-detection, and a periodic top-15 summary. Snapshot endpoint at `/api/dev/fetch-stats`. Use this when chasing fan-out / leak issues — observable counts beat guessing.
- AWS SDK clients (S3, Lambda, Secrets Manager) bypass `globalThis.fetch`, so the probe doesn't see them. If suspected, add a separate probe.

## Key Commands

```bash
pnpm --filter debug-console dev          # Local dev (port from server.ts)
pnpm --filter debug-console typecheck
pnpm --filter debug-console test
pnpm --filter debug-console lint
```

## PR checklist

Every PR that touches debug-console should answer: **does this change anything in CLAUDE.md still describe?**

Update CLAUDE.md when the PR:

- adds, removes, or repurposes a top-level directory
- adds or removes a caching layer, scheduler, or background worker
- adds or removes an upstream dependency category (a new ES cluster, queue, etc.)
- changes the dev-mode workflow (new env vars, instrumentation, opt-in flags)
- changes the audience / SLA / review-rigor framing

Skip the update when the change is a bug fix, a UI tweak, a new internal helper that fits an existing layer, or anything else a maintainer can derive from the source. **Aim for a small, durable doc** — not exhaustive coverage. If you're unsure, leave it.

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
