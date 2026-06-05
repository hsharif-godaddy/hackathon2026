# Enhanced Investigate — Design

Date: 2026-06-02
Branch: `feat/investigate-enhanced`
Supersedes: the `troubleshooter/` effort (`docs/superpowers/specs/2026-05-26-troubleshooter-design.md` and Plans 1–6). The troubleshooter is retired; its reusable ideas fold into the existing Investigate feature.

## Summary

Enhance the existing `investigator/` Lambda and the debug-console **Investigate** UX in place. Do **not** build a new service. The goal: make Investigate faster and give it far richer context by adding three new evidence sources — **customer app code**, **platform source code**, and **agent conversations** — while removing two slow/low-value ones (**Langfuse**, **FullStory**) and modernizing the log pipeline to be source-aggregated and token-efficient.

Everything runs through **one path**: both a manual "Investigate" click in the console and an automated `feedback`-row trigger use the same direct-evidence flow. The Lambda mints its own credentials regardless of trigger. The old JOMAX-proxy manual path is retired.

## Goals

- Add code context: the agent can read the customer's app code *and* the platform monorepo, efficiently (no full-text dump).
- Add agent-conversation context: what the develop-agent attempted, its tool calls, outputs, and errors.
- Make log processing fast and high-coverage: aggregate at the source, compress duplicates, drill on demand.
- Collapse the two investigation paths (manual proxy vs. automated direct) into one.
- End every investigation with a **verdict** (agent-bug / customer-error / platform-bug / external / no-issue + what it relates to) and, when the fix lives in the app, a **copy-paste fix prompt** the operator can drop into the customer app's develop-agent.
- Remove Langfuse and FullStory from Investigate.
- Keep blast radius contained: Langfuse stays wired for the analytics dashboard, evals, and the metrics exporter.

## Non-goals

- No new long-running service. The investigator Lambda stays the execution host.
- No customer-facing communication / CRM outreach changes (out of scope, as before).
- No "apply fix" automation in this spec.
- No bug-time-SHA code pinning in v1 (zip is current workspace HEAD; SHA pinning is a later enhancement).

## Architecture

```
trigger: console "Investigate" click  OR  feedback row   →  ONE path (direct mode)
        │
        ▼  investigator Lambda (Claude Sonnet 4.6, bundled CLI)
  ┌──────────────────────────────────────────────────────────────────┐
  │ PRE-SPAWN orchestration (handler.mjs, Node):                       │
  │   • mint agent JWT (port of debug-console agent-jwt) ──┐           │
  │   • GET {agentUrl}/apps/:id/zip      → unzip /tmp/app  │  exactly  │
  │   • GET {agentUrl}/agent/conversations/:appId          │  how the  │
  │        → /tmp/conversations.json  ─────────────────────┘  console  │
  │                                                           does it   │
  │   • build customer code graph on /tmp/app                          │
  │        (code-review-graph, postprocess=minimal)                    │
  │   • collect logs via the new SOTA pipeline (Loki + ES)             │
  ├──────────────────────────────────────────────────────────────────┤
  │ SPAWN Claude with context + tools:                                 │
  │   • log digest (level/time histograms, ranked templates, rare      │
  │     errors)  +  fetch_log_lines drill tool                         │
  │   • /tmp/conversations.json (agent turns, tool calls, errors)      │
  │   • /tmp/app on local FS → native Read / Grep / Glob               │
  │   • MCP code-review-graph:                                         │
  │        - customer graph  (repo_root=/tmp/app, built at runtime)    │
  │        - platform graph  (repo_root=/tmp/platform-graph, loaded    │
  │                           from S3; refreshed 2x/day by GH Actions) │
  │   phases: gather → drill (graph + file + log drill) → synthesize   │
  └──────────────────────────────────────────────────────────────────┘
        ▼  report.md → S3; state / events / heartbeat unchanged
  console streams the run over SSE (unchanged)
```

## Components

### 1. Credential minting (`investigator/agent-jwt.mjs`, new)

Port of `debug-console/src/lib/agent-jwt.ts`. Mints a short-lived RS256 JWT accepted by the agents service:
- Key from AWS Secrets Manager (`JWT_SECRETS_NAME`, same JSON shape as app/'s JWTService); static-key fallback via `AGENT_JWT_PRIVATE_KEY` + `AGENT_JWT_KEY_ID` for tests.
- Claims: issuer `airo-app`, audience `agents-service`, appId-scoped, `canDownload: true`, 5-minute TTL.
- The Lambda already mints GoCode S2S JWTs and reads Secrets Manager, so this adds no new infra capability.

**Where auth runs — in the Lambda, for both triggers.** The console (manual click) and the feedback-fanout BFF (automated) do nothing but **invoke the Lambda**; they perform no token minting or evidence collection. The Lambda runs one script for both triggers and mints the agent JWT itself. This is required because automated feedback runs never pass through the console.

**`agentUrl` in the trigger payload.** Both triggers already resolve `agentUrl` for the app (the console uses `getAgentUrl(appId)` for every other agent call; the BFF resolves the app to invoke it), so the **invoke event carries `agentUrl`**. The Lambda resolving it via mgmt credentials is only a fallback for the rare case it is absent. If it cannot be resolved, code + convo sources are skipped (logs-only) with a note in the report.

**New IAM grant.** The only new platform capability the Lambda needs is **Secrets Manager read on the JWT signing secret** (`JWT_SECRETS_NAME`). With `agentUrl` supplied in the payload, no mgmt credentials are needed on the common path.

### 2. Customer code + conversations (HTTP, agent-token auth)

Mirrors exactly how the console pulls these today:
- **Code:** `GET {agentUrl}/apps/:id/zip` (route already requires `canDownload`). Stream to `/tmp/<investigationId>/app.zip`, unzip to `/tmp/<investigationId>/app/`. The agent then uses **native Read / Grep / Glob** over that local tree — no per-file HTTP, no agents file-routes.
- **Conversations:** `GET {agentUrl}/agent/conversations/:appId` (+ `/:id` for details). Persist to `/tmp/<investigationId>/conversations.json`. Contains user/agent turns, `tool_calls` (name + input + output), `message_type`, errors, and `origin`.

Because whole-zip + native FS covers granular file access, the agents **support-JWT internal routes** (`/workspace/*`, `/transcripts/*`) added for the troubleshooter are **not used** and are removed with it (see §8).

### 3. Code-review-graph integration

**Image — same-base multi-stage `pip install --target` (so MCP + python are reliable).** Verified in the Task 0.1 spike (`docs/superpowers/notes/2026-06-02-investigate-pydeps-mcp-spike.md`): `dnf install python3.11` gives **Python 3.11.15**; code-review-graph 2.3.5 + drain3 0.9.11 install + import cleanly; final image ≈ **1.21 GB**.
- **Critical gotcha (pinned):** the Lambda nodejs base puts Node's OpenSSL (`/var/lang/lib`) first on the loader path, which lacks `COMP_get_type@OPENSSL_3.0.0`, so python's `_ssl` (hence pip's HTTPS) breaks. **Fix: `ENV LD_LIBRARY_PATH=/usr/lib64` in BOTH stages** so python resolves the AL2023 system OpenSSL. (Same fix `run_search_frontend_logs.sh` already applies.)
- **Build stage** (`FROM <same lambda base> AS pybuild`, `ENV LD_LIBRARY_PATH=/usr/lib64`): `dnf install python3.11 python3.11-pip gcc gcc-c++ make`, then `python3.11 -m pip install --target /opt/py-packages code-review-graph drain3`. tree-sitter ships manylinux wheels, so nothing compiles; gcc is insurance.
- **Runtime stage** (same base, `ENV LD_LIBRARY_PATH=/usr/lib64`): `dnf install python3.11`, `COPY --from=pybuild /opt/py-packages /opt/py-packages`, `ENV PYTHONPATH=/opt/py-packages`.

Both stages use the identical base, so the python3.11 ABI matches and the copied packages just work. gcc/pip never ship in the final image.

**Platform graph (scheduled build → S3 → runtime load, NOT baked).** Baking into the image was wrong-scope (only the build context) and stale (refreshes only on deploy). Instead:
- **Builder — GitHub Actions cron, 2×/day** (`.github/workflows/refresh-platform-graph.yml`, + manual dispatch): checks out `main`, `pip install code-review-graph`, builds the graph scoped to **`agents/` + `app/` + `app-templates/`** (`code-review-graph build --repo <composed-root> --skip-flows`), uploads `graph.db` to `s3://${STATE_BUCKET}/platform-graph/graph.db` via the existing OIDC role. Decoupled from deploys; graph is always ≤12h fresh.
- **Runtime load:** the Lambda's `ensurePlatformGraph()` downloads the latest `graph.db` from S3 to `/tmp/platform-graph/.code-review-graph/graph.db` (cached across warm invocations; re-fetch only when the S3 ETag changes). The agent queries the platform graph with `repo_root=/tmp/platform-graph`. Soft-fail: if the object is missing/unreadable, the platform graph is simply unavailable (Read/Grep + customer graph still work).
- The image therefore bakes the **python deps only** (code-review-graph + drain3), not the graph. Customer graph still builds at runtime in `/tmp/<id>/app`.

**Builder efficiency + hard excludes (must):**
- **Scope to source only:** index `agents/src`, `app/src`, `app-templates/` source — NOT `node_modules`, `dist`, `.next`, `build`, `out`, `coverage`, `.git`, generated/`*.min.*`, lockfiles, or vendored trees. code-review-graph honors `.gitignore` (so `node_modules`/build are already excluded), and the builder additionally composes a clean source-only root so nothing heavy is parsed. This keeps parse time + graph size small.
- **Incremental, not full, when possible:** cache the prior `graph.db` in the Actions cache; run `code-review-graph update` (incremental — only changed files since last run) instead of a full `build` when a cached graph exists, falling back to `build --skip-flows` on a cold cache. `--skip-flows` everywhere (signatures + FTS only; skip expensive flow/community detection).
- **Conditional upload:** hash the produced `graph.db`; skip the S3 upload when unchanged, so the Lambda's ETag check is a no-op and warm containers never re-download an identical graph.
- **Fast Lambda load:** single S3 GET, gated on ETag, cached for the warm-container lifetime; the graph is a read-only SQLite query at investigation time (no parse).

**Customer graph (runtime):** after unzip, run `build_or_update_graph(repo_root=/tmp/<id>/app, postprocess=minimal)`. Customer apps are small; minimal postprocess keeps it inside the 14-minute budget. If it fails or is slow, fall back to ripgrep/Read over the unzipped tree.

**Exposure to the agent — code-review-graph MCP over stdio.** The bundled Claude CLI is launched with `--mcp-config /tmp/<id>/mcp.json` whose single `mcpServers` entry spawns the code-review-graph MCP server over **stdio**:
```jsonc
{ "mcpServers": { "crg": {
    "command": "python3.11",
    "args": ["-m", "code_review_graph", "serve"],
    "env": { "PYTHONPATH": "/opt/py-packages", "LD_LIBRARY_PATH": "/usr/lib64" } } } }
```
(Spike 0.1 pinned: there is no `code_review_graph.mcp` module; the stdio MCP server launches via the package CLI — `python3.11 -m code_review_graph serve`, console scripts at `/opt/py-packages/bin/{code-review-graph,crg-daemon}`. `LD_LIBRARY_PATH=/usr/lib64` is required in the env for the same OpenSSL reason. The exact `serve` vs `mcp` subcommand is confirmed by the deferred creds smoke `spike-mcp-smoke.sh`.) stdio means the CLI spawns the server as its own child and manages its full lifecycle (start + kill on exit) — no ports, no readiness polling, and it runs fine under the Lambda sandbox user (UID 1001). The graph tools take `repo_root` per call, so the one server serves both the customer graph (`/tmp/<id>/app`) and the platform graph (`/opt/platform-graph`). The agent uses `semantic_search_nodes`, `query_graph` (callers_of / callees_of / imports_of / tests_for / children_of), and `get_impact_radius` to navigate structurally, then opens exact files with Read.

### 4. Log pipeline (SOTA — `investigator/skills/airo-log-investigate/search_frontend_logs.py`, rewritten)

Replaces deep raw-line pagination. Coverage **increases** (no page cap); tokens **decrease**.

**Stage 1 — server-side aggregation (full coverage, tiny payload).**
- **CRITICAL — must scope by `cluster` + `service_name` LABELS.** `app_id` is Loki **structured metadata**, not a label, so it does NOT prune chunks — `{env,plane} | app_id="X"` reads *every* app's logs for the window then post-filters (measured: ~386 GiB/hour, unusable). Adding the `cluster` + `service_name` labels prunes to the right streams first (measured: ~1.5 GiB, fast). The `cluster` is derived from the `agentUrl` already in the trigger payload — agent URLs are `<appId>.<service>.<cluster>.airoapp.ai`, so the handler parses `cluster` (port of `extractClusterFromUrl`) and passes it to the skill as `LOKI_CLUSTER`. The level field is `detected_level` (confirmed via Grafana).
  ```logql
  sum by (service_name, detected_level) (
    count_over_time({env="prod", plane="data", cluster="c24",
      service_name=~"airo-(agents|preview-application|publish-application)"}
      | app_id="<id>" [<window>])
  )
  ```
  Plus a time histogram (`count_over_time` per bucket) to locate busy/error windows. Control-plane uses `plane="control"` with the same cluster filter. If `cluster` can't be derived, the aggregation degrades (warn + skip) rather than running an unbounded scan.
- **Elasticsearch** aggregations (terms on level, `date_histogram`, error cardinality) for the **frontend/Katana FOS** logs only (the one source not in Loki).

**Stage 2 — template mining (Drain3, `pip install drain3`).**
Pull a **bounded sample** of raw lines, targeted at error/warn levels and the busy buckets Stage 1 surfaced. Run Drain3 to cluster near-identical lines into templates, masking variable tokens (IDs, IPs, UUIDs, numbers → `<*>`). Output: a small set of templates, each with an occurrence count and 1–2 verbatim exemplars. Rare-error lines (count ≤ 3) are pulled **verbatim, not sampled**, so one-offs are never lost to sampling.

**Stage 3 — digest to the model.**
Emit a compact structured digest: level histogram, time histogram, templates ranked by `error-level × rarity × recency`, and the verbatim rare errors. Hundreds of tokens, full coverage.

**Stage 4 — drill on demand (agent tool).**
`fetch_log_lines(source, template_or_signature, time_bucket)` returns the actual raw lines for a specific template/window. The agent pulls raw lines only for the 2–3 signatures it is actively chasing. Nothing is hidden — the digest is the index; raw lines are one tool-call away.

**Source registry & label schema.** Loki sources are a config list keyed by label selector, so adding a stream is one entry. Known/useful streams: data plane — `airo-preview-application`, `airo-publish-application`, `airo-agents`, `airo-db-init`, `airo-pre-start`; control plane — `plane="control"` streams (mgmt). Label schema: labels `{env, plane, service_name, cluster}`; structured metadata `app_id`, `detected_level`. A `service_name=~"..."` regex can span planes in one query.

**Backward compatibility.** Structured-metadata `app_id` is only ~1 day old in prod. For windows that start before the rollout date, the query layer falls back to the old line-substring match (`|= "\"app_id\":\"<id>\""`). The cutover date is a config constant.

**Elasticsearch role.** Loki-primary for data and control planes. ES is queried **only** for frontend/Katana FOS logs (airobuilde ESSP cluster), which are not in Loki. This shrinks the ES code path to a single source.

### 5. Prompt / skill changes (`investigator/prompt.mjs`, skill)

- Default mental model: **the bug is in the customer's app.** Escalate to the **platform graph** only when a stack trace, conversation, or log template points at platform internals (agents, preview, publish, dev-supervisor). This keeps token spend down.
- Phases: **gather** (log digest + conversations + code map) → **drill** (graph queries + file reads + `fetch_log_lines`) → **synthesize** (report with code/log citations + verdict + fix, see §5a).
- Tooling described to the agent: local FS over `/tmp/app`, code-review-graph MCP (customer + platform), `fetch_log_lines`.

### 5a. Verdict + fix prompt (synthesis output)

Every investigation ends with two **structured** outputs, written both into `report.md` and into the `analysis.json` sidecar (the handler already uploads this sidecar for the UI's sentiment/rootCause fields — extend it rather than scraping markdown).

**1. Verdict (attribution) — always produced:**
- `category`: one of
  - `agent-bug` — the develop-agent produced wrong code / mis-used a tool;
  - `customer-error` — user mistake or expected behavior, not a defect;
  - `platform-bug` — an Airo platform defect (agents / preview / publish / dev-supervisor / control-plane);
  - `external` — third-party, dependency, or infra outside our control;
  - `no-issue` — nothing wrong / could not reproduce.
- `relatesTo`: short tag, e.g. `preview-build`, `auth/session`, `publish-pipeline`, `data-fetch`.
- `confidence`: `low | medium | high`.
- `rationale`: 1–3 sentences citing the concrete evidence that drove the call (a log template, a conversation turn, a code location).

**2. Fix — shape depends on category:**
- **App-fixable** (`agent-bug`, or a `customer-error` resolvable by a code change): a **copy-paste fix prompt** — a self-contained instruction the operator pastes into the customer app's develop-agent chat. It names the exact files/symbols (from the graph) and the concrete change, written as if addressing the develop-agent. Copy-paste only; **not** auto-applied (apply remains out of scope per non-goals).
- **`platform-bug`**: an **engineering note** instead (which service, what's wrong, suggested area) — the customer's app agent cannot fix platform code, so no app prompt is emitted.
- **`external` / `no-issue`**: a short explanation; no prompt.

The agent is instructed to ground both outputs in cited evidence and to prefer `no-issue` / `customer-error` over inventing a defect when the signals are weak (fail-toward-benign, so support isn't sent to "fix" a non-bug).

### 6. Debug-console changes

- The console is **trigger-only**. `POST /api/investigate` no longer forwards a JOMAX token, mints any token, or collects evidence — it resolves `agentUrl` and invokes the Lambda with `{ appId, customerId, feedback, agentUrl, source: 'console' }`, identical in shape to the fanout invoke. All auth and evidence happen Lambda-side.
- Retire the console-proxy evidence collection (`debug-console/src/lib/investigate/evidence.ts`) and the proxy endpoints it fed (`/api/es-logs`, `/api/investigate-evidence`) **after verifying no other consumers** (e.g. the analytics/summaries views) depend on them.
- Remove the **FullStory URL** form field from `InvestigatePanel.tsx`.
- Render the **verdict** (§5a) as a colored badge (by `category`) with `relatesTo` + `confidence`, and the **fix** block with a **"Copy fix prompt"** button when an app-fix prompt is present (engineering note / explanation rendered as plain text otherwise). Reads from the `analysis.json` sidecar fields, not scraped markdown.
- SSE streaming, state, report rendering, and the embedded-mode flow are otherwise unchanged.

### 7. Error handling — soft-degrade per source

Each source is independent and degrades softly, mirroring today's per-source error capture. No single source miss hard-fails the run; each emits a note in the report:
- zip fetch fails → investigate without code.
- conversation fetch fails → investigate without agent context.
- customer graph build fails/slow → ripgrep/Read fallback over the unzipped tree.
- platform graph missing → `semantic_search` degraded; structural queries unavailable.
- `agentUrl` unresolved → logs-only.
- a Loki/ES source errors → that source omitted; others proceed.

### 8. Removed / retired

- **Langfuse fetch in Investigate** (`_fetch_langfuse_all`, the `langfuse` evidence source, `EB_LANGFUSE_*` use in the skill). Langfuse stays wired for the `/analytics` dashboard, the evals pipeline, and the metrics exporter Lambda — those need token/latency/cost/span data that conversations lack.
- **FullStory** entirely from Investigate: `_fetch_fullstory_all`, the MCP segment-discovery path, the `fullstoryUrl` param, the `FULLSTORY_API_KEY` secret wiring, and the UI field.
- **JOMAX-proxy manual path** + console proxy evidence collection (§6).
- **`troubleshooter/`** directory, its CI workflow (`.github/workflows/aws-deploy-troubleshooter.yml`), and the agents support-JWT internal routes (`/workspace/*`, `/transcripts/*`) added solely for it — superseded by the agent-token + zip/conversations approach.

## Data sources (final)

| Source | How | Auth |
|---|---|---|
| Logs — data + control plane | Loki, structured-metadata `app_id`, server-side aggregation + Drain3 + drill | Secrets Manager (Loki key) |
| Logs — frontend / Katana FOS | Elasticsearch aggregations | Secrets Manager (ES key) |
| Agent conversations | `GET /agent/conversations/:appId` | minted agent JWT |
| Customer app code | `GET /apps/:id/zip` → unzip + code-review-graph + native FS tools | minted agent JWT |
| Platform source | pre-baked code-review-graph in image | none (in image) |
| ~~Langfuse~~ | removed from Investigate | — |
| ~~FullStory~~ | removed from Investigate | — |

## Testing

- **Unit:** agent-JWT mint (static-key path); zip download + unzip; code-review-graph build wrapper (invocation + failure fallback); each log-pipeline stage (aggregation query construction, Drain3 template output, digest shaping, backward-compat selector); each source soft-degrade branch.
- **Integration:** synthetic appId → mock agent routes returning a fixture zip + conversations → assemble evidence → assert the digest is produced, graph queries are issued, and the report cites code + log templates.
- **Retire:** console-proxy evidence tests; Langfuse-source and FullStory-source tests in the skill.

## Risks

- **python deps in the image** — solved by same-base multi-stage `pip install --target` (build stage) + `COPY` + `dnf install python3.11` (runtime). The one thing to confirm in the Task 0.1 spike: that `dnf` on the nodejs base actually exposes `python3.11` (+ `python3.11-pip`); if it only has `python3.9`, use that version in both stages.
- **Image size** — package + tree-sitter grammars + baked platform graph DB ≈ +300–500 MB. Target < 1.5 GiB (Lambda allows 10 GiB); measure in CI. Bigger image → a few extra seconds cold start, immaterial for minutes-long investigations.
- **Platform graph staleness** — rebuilt each deploy; tracks the deployed SHA, not live `main`.
- **Customer graph build time** — runtime `build_or_update_graph(postprocess=minimal)` on a small app is seconds; must fit the 14-minute budget; ripgrep/Read fallback on failure.
- **Drain3 sampling** — a freak one-off could escape templating; mitigated by Stage-1 counts, verbatim rare-error pull, and the drill tool.
- **Loki control-plane ingestion is ~1 day old** — chosen Loki-primary with ES-fallback only for frontend; if control-plane gaps appear, the source registry can temporarily re-add an ES control-plane source.

## Open questions (resolve at plan-detail time)

- Confirm `dnf` on the Lambda nodejs base exposes `python3.11`/`python3.11-pip` (Task 0.1 spike); and the exact code-review-graph MCP entrypoint command (`python -m code_review_graph.mcp` vs a console-script).
- Exact `detected_level` / level field names per Loki stream (confirm via the label browser).
- Confirm no analytics/summaries consumer depends on the console proxy evidence endpoints before removing them.
- Platform graph build time + size in CI — is `postprocess=minimal` enough for useful platform queries, or is full postprocess needed (and does it still fit the image budget)?
