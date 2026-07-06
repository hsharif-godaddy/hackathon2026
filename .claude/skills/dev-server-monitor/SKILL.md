---
name: dev-server-monitor
description: >-
  Watch the local Airo Builder dev server (agents, app, control-plane) while it
  runs — both to catch real problems and to observe a run's progress and timing.
  Use whenever the user asks to monitor, watch, tail, or "keep an eye on" the dev
  server or its logs, to be told when something breaks / errors / crashes, OR to
  time a build/workflow, see where the time went (per-phase durations), be told
  when a run finishes, or learn which agent flow ran — even if they don't say
  "monitor". Covers finding the per-service dev.log files, arming a live monitor
  (for errors, or for lifecycle/timing markers), separating genuine failures from
  the many benign local-dev warnings, extracting per-phase timings, and drilling
  into an app-specific failure by exporting that app's agent conversation.
---

# Dev Server Monitor

Watch the running local dev server and tell the developer about **real** problems
as they happen, without drowning them in the routine warnings that a local
environment emits constantly.

The core insight this skill encodes: in local dev, **silence from most WARN/ERROR
lines is correct**. Half the scary-looking output is external services that simply
aren't reachable from a laptop (the event bus, mgmt-airo record-event), ownership
guards firing during polling, or features that are off locally. A useful monitor
suppresses that known noise so the one line that actually matters — a compile
failure, a crash, a tool timing out, a 5xx on a real route — isn't buried.

## When to use this

Triggers: "monitor the dev server", "watch the logs", "tell me if anything breaks",
"keep an eye on agents while I work", "is the dev server healthy?", or any request
to be notified of errors during a local `pnpm run dev` session.

There are **two modes**. Steps 0–6 below are the **error/health monitor**. When the
ask is instead "how long did that build take / where did the time go / tell me when
it finishes / which flow ran" — that's the **timing & lifecycle** mode; jump to
"Second mode" near the end. Both watch the same running server.

The most common invocation is **"monitor the dev server for X"** — where X names a
*scope* the developer is working on (a route, an app, a feature/log domain, an error
class). Treat that X as the whole point: do **Step 0** to turn it into a targeted
filter before arming anything. A bare "watch for anything" falls back to the broad net.

**Composes with dev-runner, doesn't replace it.** The `dev-runner` TUI already flags
hard process death live (its scanner matches a tight set — `FATAL`, `panic:`,
`EADDRINUSE`, `Module not found` — and runs HTTP health checks per service). That's a
coarse "is it up / did it crash" signal for a human at the terminal. This skill is the
*contextual, scoped, agent-driven* layer on top: watch for the specific thing the
developer named, classify it, and explain it — which dev-runner's fixed patterns can't.

If the dev server isn't running yet, say so — this skill watches an already-running
server; it does not start one. (`pnpm run dev` starts it.)

**Commands assume macOS/BSD** (the common local-dev host): `stat -f`, `sed -l`. GNU
fallbacks are noted inline where they differ (`stat -c`, `stdbuf -oL sed`/`sed -u`).

## Step 0 — Scope the watch to what they asked about

When the ask is "monitor for X", turn X into the **positive** grep pattern the live
monitor (Step 3) matches on, then AND-in the failure signatures. Scoping is what makes
the monitor useful *and* quiet: if you grep for `publish` + failures, the constant
global event-bus/telemetry noise never matches, so the Step 4/5 noise handling barely
has to fire. Map the subject:

| "monitor for…" | Positive pattern to build |
| --- | --- |
| a route/endpoint (`/api/.../publish`) | that path, plus `5[0-9][0-9]` and `Error:` |
| an appId | `appId:<id>` and `/apps/<id>/` — mind the 8-vs-10-char truncation trap (Step 6) |
| a feature / log domain (`workflow`, `subscription`, `preview`, `publish`) | that `domain.op` tag prefix, plus the failure signatures |
| an error class ("5xx", "timeouts", "crashes") | just those signatures (`5[0-9][0-9]`, `timed out`, `panic:`/`exited with`/`crashed`) |
| "anything" / "errors in general" | no scope — use the broad fallback net in Step 3 |

Combine the subject with the failure signatures so you catch both "a line about X" and
"a failure near X", e.g. for X = the publish flow:

```bash
POS='publish|/apps/[a-z0-9]{10}/publish| 5[0-9][0-9] in |Error:|panic:|exited with|timed out'
```

Carry `POS` into Step 3. State back to the developer what scope you armed.

## Step 1 — Locate the logs and confirm they're live

The `dev-runner` TUI writes each process's stdout/stderr to a per-service
`dev.log`, ANSI-stripped, **truncated on each restart**. The three that matter:

| Service | Log | Format |
| --- | --- | --- |
| Agents API (`@airo/agents`, :4000) | `agents/dev.log` | `[time] EMOJI LEVEL {domain.op} …` + some Rust ECS JSON lines |
| App / Next.js BFF (`website`, :3000) | `app/dev.log` | `[N] LEVEL domain.op …` and `GET /path 200 in 3ms` |
| Local control plane (:4100) | `local-control-plane/dev.log` | `time=… level=… msg=…` |

Discover them and confirm freshness (a stale mtime means that process isn't
running or isn't logging):

```bash
for f in app/dev.log agents/dev.log local-control-plane/dev.log; do
  echo "=== $f ($(wc -l < "$f") lines, modified $(stat -f '%Sm' "$f" 2>/dev/null || stat -c '%y' "$f")) ==="
  tail -n 4 "$f"
done
```

If a file is missing, `find . -path ./node_modules -prune -o -name dev.log -print`
finds any others. Confirm the dev-runner process is alive if all three look stale:
`ps aux | grep -E "dev-runner|pnpm run dev" | grep -v grep`.

## Step 2 — Baseline scan before arming

Scan for errors/warnings **already** in the logs first, so you can (a) report the
current state and (b) distinguish pre-existing conditions from anything new the
live monitor catches. Report these to the user as the starting baseline, tagged as
pre-existing.

```bash
for f in app/dev.log agents/dev.log local-control-plane/dev.log; do
  echo "=== $f ==="
  grep -iE "error|warn|❌|⨯|panic|ECONNREFUSED|EADDRINUSE|unhandled|traceback|module not found|failed to compile" "$f" | tail -n 8
done
```

## Step 3 — Arm the live monitor

Use the **Monitor** tool (not a bare `tail`) so each real event becomes a
notification while you keep working. Tail all three files, tag each line with its
source, and filter to failure signatures. Run it `persistent: true` — a dev-server
watch should last the session.

Monitor command — the final `grep -E "$POS"` uses the **scoped** pattern from Step 0.
When the ask was "watch for anything", set `POS` to the broad fallback net below:

```bash
cd <repo-root>
# Scoped from Step 0, OR this broad fallback for "monitor for anything":
POS="${POS:-ERROR|WARN|❌|⨯|panic:|Traceback|Unhandled|ECONNREFUSED|EADDRINUSE|ETIMEDOUT|ENOTFOUND|EADDRNOTAVAIL|MODULE_NOT_FOUND|Cannot find module|Failed to compile|Module not found|Error:| 5[0-9][0-9] in | - 5[0-9][0-9] \(|exited with|crashed}"
{ tail -n0 -F app/dev.log                 | sed -l 's/^/[app] /' & \
  tail -n0 -F agents/dev.log              | sed -l 's/^/[agents] /' & \
  tail -n0 -F local-control-plane/dev.log | sed -l 's/^/[cp] /' & \
  wait; } | grep --line-buffered -E "$POS"
```

Why it's built this way:
- `tail -n0 -F` starts at the end (no replay of the baseline) and follows **by
  name**, so it survives the truncate-on-restart behavior of these logs.
- `sed -l 's/^/[tag] /'` prefixes each line with its source and stays
  line-buffered (BSD/macOS `sed -l`), so you always know which service spoke.
  On GNU/Linux sed use `stdbuf -oL sed 's/^/[tag] /'` (or `sed -u`) instead —
  there `-l` expects a numeric argument and the pipeline would break.
- The **fallback** alternation (used only when no scope was given) is deliberately
  **broad** — it matches uppercase `ERROR`/`WARN` levels (all three logs emit them),
  plus crash/compile/connection/5xx signatures. Case-sensitive `-E` avoids matching
  "error" inside field names like `errorMessage`. Coverage over precision: better to
  see a benign line and suppress it in Step 5 than to miss a crash. Whether scoped or
  broad, keep every terminal failure signature (`panic:`, `exited with`,
  `ECONNREFUSED`, 5xx) in `POS` so a crash near the subject is never silently dropped.

Set the Monitor `description` to something specific like
`"dev server errors/warnings (app, agents, control-plane)"` — it shows on every
notification.

## Step 4 — Classify each event: real problem vs. benign local noise

For every event, decide whether it's actionable. `references/known-noise.md` lists
the recurring benign patterns this environment emits and *why* each is expected
locally — read it before calling anything a "problem". The short version:

- **Benign, expected locally:** anything from `event_bus_client` / "Failed to send
  batch to event bus", `/api/apps/<id>/events` 502 + `mgmt-airo.record-event.error`
  (same unreachable event bus), `subscription.api.get-by-id.forbidden`,
  `model.provider.fallback`, `care.bridge.disabled`, `fga.skip-not-configured`,
  `path-helper.absolute-to-relative`, `share.*.noCellPrefix` / `previewUrl.*failure`.
- **Watch only if it repeats / loops:** `preview-pane.iframe.bootstrap-timeout`
  (self-remounts once; a loop means the preview is genuinely stuck),
  `duplicate_response.detected` (agent retry; fine once, a stall if sustained),
  `stream.tool.slow_execution` for `runWorkflow` (a build legitimately takes
  minutes).
- **Real — surface immediately:** compile failures (`⨯`, `Failed to compile`,
  `Module not found`), crashes / `panic:` / `exited with` / unhandled rejections,
  `ECONNREFUSED`/`EADDRINUSE` (a service is down or a port clashed), 5xx on a real
  app route, and tool-execution failures / timeouts (e.g. `screenshot … timed out`,
  `ai-lib.agent-factory.tool.execution.failure`).

When you report a real issue, pull the surrounding lines for context
(`awk '/HH:MM:SS/{f=1} f{print} …'` or `grep -n` around the timestamp) rather than
relaying the single matched line — the cause is usually a line or two away.

## Step 5 — Refine the filter as noise recurs

The first monitor run reveals which benign patterns *this* session emits. When one
recurs and you've confirmed it's benign (Step 4), stop the monitor and restart it
with that pattern excluded, so real signal stays visible and the monitor doesn't
trip its own volume cutoff. Add a second grep stage:

```bash
… | grep --line-buffered -vE "event_bus_client|Failed to send batch to event bus|subscription.api.get-by-id.forbidden|path-helper.absolute-to-relative"
```

Tell the user each time what you added to the exclusion list and why. Grow the
`-vE` list across the session; leave the positive `POS` match as scoped in Step 0
(a well-scoped watch rarely needs much exclusion — the noise never matches it).

## Step 6 — Deep-dive an app-specific failure

Many real errors carry an `appId` (e.g. `appId:dy2zsqm1y8`, or in a route path
`/apps/dy2zsqm1y8/…`). When a failure is tied to one app and the log line alone
doesn't explain it, export that app's full agent conversation — including every
tool call, its arguments, result, duration, and error — straight from the local
SQLite DB. This shows what the agent was *doing* when the log error fired
(which tool, what inputs, what it returned):

```bash
cd agents
pnpm tsx scripts/local-export-chat.ts <appId>              # full transcript
pnpm tsx scripts/local-export-chat.ts <appId> --detail=summary   # messages + tool names/status only
```

It needs no running service or auth (reads `agents/data/apps.db` read-only — note
that `agents/data/agents.db` exists but is empty; the data is in `apps.db`) and
prints Markdown to stdout — redirect to a file for a long conversation. Use the
`summary` detail to first spot which tool failed, then re-run `full` if you need
that tool's arguments and result. This is the bridge from "a screenshot tool timed
out for app X" to "here's the exact call and state that produced it."

**Trap — the log truncates the appId.** The `[app:xxxx|agent:…]` log prefix shows
only **8 chars**, but real app ids are **10** (`[a-z0-9]{10}`). Passing the
truncated id makes the export exit with "No conversations found" (not an error).
Prefer the full id from a `/apps/<id>/…` route path or an `appId:<id>` field. If the
export finds nothing, recover the full id from the DB:

```bash
sqlite3 agents/data/apps.db "SELECT DISTINCT app_id FROM conversations ORDER BY rowid DESC LIMIT 5;"
```

**Inspect what the build actually wrote.** The transcript shows what the agent *said*
it did; to see the files on disk, `docker exec` into that app's preview container
(`docker ps | grep preview`), whose workspace is `/app`:

```bash
docker exec preview-<appId>-1 sh -c 'ls /app/docs; cat /app/docs/plan.json 2>/dev/null'
```
This is how you confirm a "wrote the plan / built the page" claim against reality.

## Second mode — observe a run (timing & lifecycle)

When the ask is "how long did that build take / where did the time go / tell me when
it finishes / which flow ran," you're watching **INFO-level lifecycle lines that the
error monitor (Step 3) deliberately ignores** — so watch for them explicitly instead.
All are in `agents/dev.log`.

> **Confirm the markers against the live log first.** The domain strings below are the
> ones the agents code emits (`agents/src/workflow/*`, `packages/ai-lib` agent factory,
> `develop-agent.ts`), but log strings drift. Before relying on a grep, run it once
> against the real `agents/dev.log` and adjust — do **not** assume a marker exists.
> Note there is **no run-level `workflow.run.start/done` marker and no `phase:` line**;
> the workflow engine logs per-*step* transitions, and no lifecycle line carries a
> duration field, so per-phase timing comes from **subtracting `[timestamp]`s**.

**Which flow ran** (classic loop vs. the workflow engine) — key on the log *domain*, not
an `agent:` tag (there is no `agent:workflow` tag; agent ids are `initial`/`develop`/
`deep-build`/…):

```bash
echo "workflow-engine step lines: $(grep -acE 'workflow_transitions\.|workflow_tool\.' agents/dev.log)"
echo "classic-loop agent runs:    $(grep -ac 'agent.run.finish' agents/dev.log)"
grep -aoE "agent:[a-z0-9-]+" agents/dev.log | sort | uniq -c   # which agents ran
```

**Lifecycle markers to key on** (confirmed emitters):
- **Workflow build:** per-step `workflow_transitions.auto_assign` / `.auto_complete` /
  `.auto_fail_error` / `.gate_blocked`, `workflow_gate_resolver.interactive_completed`,
  and `workflow_tool.complete_step.*`. There is no single run-start/run-done line — the
  run window is first-to-last of these step lines.
- **Classic loop:** `agent.run.finish` per agent (fields `agentName`, `finishReason`,
  `steps`, `totalUsage` — **no** `agent.run.start`, **no** duration field),
  `setProjectName.success`, and per-tool `develop_agent.tool.execution.start` /
  `.complete` (each carries only `toolName`; the *duration* is not logged — get it from
  the exported transcript's `✓ (Nms)`, Step 6).

**Watch a run to completion (one notification when it ends).** With no run-done marker,
the reliable "a run finished" signal is the next `agent.run.finish` after the run began
(the workflow tool completes inside an agent turn, so this fires for both flows). Prefer
a background until-loop over a `tail -f` Monitor — it survives the session-boundary
teardown that kills a long-lived tail, and re-baselines if the log is truncated mid-wait
(a naive `-gt "$base"` compare would hang forever after a restart drops the count below
the captured baseline):

```bash
base=$(grep -c "agent.run.finish" agents/dev.log)
until
  cur=$(grep -c 'agent.run.finish' agents/dev.log)
  [ "$cur" -lt "$base" ] && base=0   # log truncated on restart → re-baseline
  [ "$cur" -gt "$base" ]
do sleep 5; done
```

Run that with `run_in_background: true`. For **live per-step updates** instead, arm a
Monitor tailing the step markers and exit on the finish line:

```bash
tail -n0 -F agents/dev.log \
 | grep --line-buffered -E "workflow_transitions\.|workflow_tool\.complete_step|setProjectName\.success|agent\.run\.finish" \
 | awk '{print; fflush()} /agent\.run\.finish/{exit}'
```

**Extract the breakdown after it finishes** — slice the run window from the last agent
run's first step line and read the `[H:MM:SS a.m.]` timestamps off each transition:

```bash
ln=$(grep -anE "workflow_transitions\.|develop_agent\.tool\.execution\.start" agents/dev.log | tail -50 | head -1 | cut -d: -f1)
awk -v n="$ln" 'NR>=n' agents/dev.log \
 | grep -aE "workflow_transitions\.|workflow_tool\.complete_step|develop_agent\.tool\.execution|agent\.run\.finish" | cut -c1-140
```

No lifecycle line carries a duration, so **per-step/per-phase durations come from
subtracting adjacent `[timestamp]`s**. For a quick per-tool breakdown of the classic
loop, the exported transcript (Step 6) already prints each tool's duration as `✓ (Nms)`
— often faster than differencing timestamps by hand.

**Caveat — truncate on restart wipes the numbers.** Editing agents code reloads the
tsx-watch server and **truncates `dev.log`**, so a finished run's lines can vanish. If
you're measuring, capture the breakdown right after the run and **before** any code
change — don't assume the log still holds an earlier run.

## Reporting style

- Lead with the verdict: healthy, or the specific real issue and which service.
- State the baseline once; afterward only surface genuinely new signals.
- Don't narrate every benign WARN — classify it, suppress it, move on.
- When nothing is wrong, a short "still healthy, N benign warnings filtered" beats
  silence, but don't spam it on every event.
- **Timing mode:** report the total plus the per-phase breakdown (a small table or
  `phase → duration` list) and which flow ran; call out the dominant phase. If a
  prior run's numbers are known, give the delta.
