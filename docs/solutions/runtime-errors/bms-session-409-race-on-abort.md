---
title: BMS session 409 race on user abort
date: 2026-06-02
last_updated: 2026-06-02
category: runtime-errors
module: ai-transport
problem_type: integration_issue
component: service_object
symptoms:
  - "GoCode PATCH returns 409 'session already reconciled' after agent files budget report on abort"
  - "Orphaned LLM requests continue executing after agent aborts on user Stop"
  - "$17 unattributed cost across 374 events over 8 days at 20% rollout"
  - "correlation_id_race monitoring check skipped when stepCount === 0 (abort path)"
root_cause: async_timing
resolution_type: documentation_update
severity: low
tags:
  - bms
  - race-condition
  - gocode
  - abort
  - budget-session
  - cost-attribution
  - "409"
  - orphaned-requests
related_components:
  - agents
  - budget-service
---

# BMS session 409 race on user abort

## Problem

When users click Stop during an active LLM session, the agent files a budget report immediately. If an auto-continuation had just dispatched a new LLM request to GoCode, that request continues executing (orphaned) because GoCode has no client-disconnect detection. GoCode reports cost after session is reconciled, getting 409.

## Symptoms

- 409 errors in BMS access logs: GoCode PATCH to `/api/v1/sessions/{id}` after report filed
- `budget.attribution.user_aborted` log followed by `budget.report.created`, then GoCode PATCH 409
- `correlation_id_race` monitoring does not fire for abort cases (stepCount=0 early return at `budget-report-handler.ts:404`)
- Orphaned compute: GoCode finishes requests nobody is consuming
- $17 total unattributed cost over 8 days at 20% rollout (374 events, $0.01-$0.13/event)

## What Didn't Work

**Wrong hypothesis: "GoCode takes ~6s to report cost."**

Initial investigation subtracted two agent Loki timestamps:
- `14:32:58.673 gocode.response correlationId=<correlation-id>`
- `14:33:04.363 budget.report.created`

Concluded GoCode's async cost pipeline was slow (6s). This was wrong because the two log lines belong to different request lifecycles. The first is the 3rd completed LLM call (reported fine as PATCH 200). The report is for a 4th request (auto-continuation) dispatched at 14:33:03.804.

**Why it failed:** Naive subtraction of timestamps from a single data source (agent Loki) without confirming correlationId match. The GoCode team's APM showed reporting is fast (1ms after stream completion + 386ms PATCH). The 5.1s gap was agent-side work between loop iterations. (session history)

## Solution

**Status: under discussion (2026-06-02).** No fix deployed. Awaiting cost analysis at 100% rollout to determine intervention threshold.

**Corrected timeline (session `<session-id>`):**

```
14:32:58.673  3rd LLM call completes (correlationId <correlation-id>, PATCH 200)
  ~5.1s agent-side auto-continuation (postStreamValidate + history reload + message assembly)
14:33:03.804  GoCode receives NEW LLM request (auto-continuation, iteration N+1)
  ~146ms: user clicks Stop
14:33:03.950  abort fires → budget.report.steps_received stepCount=0
14:33:04.363  budget.report.created (POST 201, session reconciled)
  GoCode finishes orphaned request → cost report 1ms later → PATCH → BMS → 409
```

**Code trace of the race window (`agent-execution-loop.ts`):**

```
Loop iteration N completes:
  line 97:  isAborted() → false
  line 108: getAutoContinuation() → { prompt }
  continue → top of loop
Loop iteration N+1:
  line 86:  isAborted() → false (user hasn't clicked Stop yet)
  line 95:  streamAgentTurn() → dispatches HTTP to GoCode
            → user clicks Stop ~146ms in
            → abortController.abort('user_stopped')
            → stream read loop breaks (line 1641)
  line 97:  isAborted() → true
  line 98:  return { termination: 'aborted' }
→ Budget report filed (line 2349)
Meanwhile: GoCode has no client-disconnect detection, finishes request
```

**GoCode codebase findings (`~/Documents/projects/gocode`):**
- Cost reporting: fire-and-forget `asyncio.create_task` after LiteLLM `async_log_success_event` (`reporter.py:133`)
- PATCH to `/api/v1/sessions/{budget_id}` with `sessionItems` array (`airo_bms.py:24-60`)
- 409 is tolerated (no retry on conflict, just logs warning)
- No client-disconnect detection in streaming handlers (`routes.py:204-223`)
- No request cancellation mechanism exists
- Design doc says ~28ms worst-case delta under normal conditions

**Proposed directions:**

1. **Accept the loss** if cost remains immaterial at full rollout
2. **GoCode cancel signal**: notify GoCode on abort to stop processing + report partial cost immediately. Addresses both wasted compute and attribution gap. Requires GoCode-side work (no existing mechanism).
3. **Grace period on abort** (2-3s delay before filing report): improves hit rate without full cancel mechanism. Tradeoff: adds latency to Stop UX.
4. **Fix monitoring blind spot** (immediate): enable `correlation_id_race` when stepCount=0 using correlationIds from GoCode response logs

**Cost data (GoCode team, 2026-06-02):**

| Date | Events | Cost |
|------|--------|------|
| 05/26 | 1 | $0.04 |
| 05/27 | 2 | $0.04 |
| 05/28 | 61 | $0.71 |
| 05/29 | 142 | $2.86 |
| 05/30 | 16 | $2.08 |
| 05/31 | 13 | $1.93 |
| 06/01 | 24 | $2.68 |
| 06/02 | 115 | $6.69 |
| **Total** | **374** | **$17.02** |

Per-event variance ($0.01 to $0.13) suggests some orphaned requests are much more expensive (tool-heavy auto-continuations).

## Why This Works

Two independent systems race with no coordination:

1. **Agent side**: abort signal fires → stream loop breaks → budget report filed immediately. The report reconciles the session.
2. **GoCode side**: has no awareness of client disconnect. Continues executing the orphaned request to completion, then fires the async cost callback via `asyncio.create_task`. Cost PATCH arrives at BMS after session is already reconciled → 409.

The race window is the time between GoCode receiving the HTTP request and the agent filing the report (~146ms in the observed case). This is short but guaranteed to exist for any request in-flight at abort time.

Prior design session (2026-05-07) anticipated this race and decided to add `correlation_id_race` monitoring and wait for prevalence data. That monitoring has a blind spot: it uses execution steps to find the last correlationId, but abort path has stepCount=0 because no tool calls completed in the aborted iteration. (session history)

## Prevention

1. **Cross-reference multiple data sources before asserting cross-service timing.** Never subtract timestamps from the same log source without confirming they represent the same request lifecycle (correlationId match). APM/distributed tracing is the source of truth, not application logs from a single service.
2. **Design async reconciliation with drain windows.** When a state transition (session reconciliation) can race with async external reporters, the transition should either wait for in-flight reporters or accept late arrivals gracefully.
3. **Ensure monitoring covers all code paths.** Race-detection checks should fire on all paths that trigger the race (abort, normal completion, error). Guard conditions like `if (steps.length === 0) return` create monitoring blind spots.
4. **Account for orphaned compute in async architectures.** When one side of a client-server connection aborts, the server may continue processing. Design for: (a) server-side cancel propagation, or (b) accept the cost and track it.

## Related Issues

- [AIROBUILD-1430](https://godaddy-corp.atlassian.net/browse/AIROBUILD-1430): Sub-second abort attribution path bug (stepCount=0 hits wrong branch)
- `docs/solutions/best-practices/budget-reconciliation-before-completion-2026-04-08.md`: Agent-side reconciliation timing (doesn't cover GoCode async PATCH race)
- `docs/solutions/logic-errors/cost-attribution-conversationid-source-2026-05-07.md`: Related stepCount=0 bug, notes abort monitoring gap
- `docs/solutions/logic-errors/parallel-reads-blocking-critical-billing-write-2026-04-07.md`: Inverse timing issue (blocking createReport)
