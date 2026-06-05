# Enhanced Investigate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the existing Investigate Lambda + console UX to read customer app code, platform source, and agent conversations; modernize the log pipeline (Loki structured-metadata aggregation + template mining + drill-on-demand); unify the manual and automated paths; remove Langfuse/FullStory from Investigate; and end every run with a verdict + copy-paste fix prompt. Retire the troubleshooter.

**Architecture:** The `investigator/` Lambda stays the execution host. The console (`POST /api/investigate`) and the feedback-fanout BFF become trigger-only — both invoke one Lambda script. The Lambda mints an `agents-service` JWT (port of `debug-console/src/lib/agent-jwt.ts`), pulls the app zip + conversations over HTTP, builds a code-review-graph index of the customer app, queries a pre-baked platform graph, and collects logs via a rewritten direct-evidence pipeline. Claude (Sonnet 4.6, bundled CLI) navigates code via the graph + local FS tools, reads the log digest, drills on demand, and synthesizes a report + `analysis.json` sidecar carrying the verdict + fix.

**Tech Stack:** Node 22 (handler, ESM `.mjs`), Python 3 (log skill, stdlib + optional drain3), Claude Code CLI 2.1.x, code-review-graph (Python MCP), AWS CDK (Lambda/IAM/Secrets), Next.js (debug-console), Vitest/unittest.

**Spec:** `docs/superpowers/specs/2026-06-02-investigate-enhanced-design.md`

---

## Reference: current-state anchors (verified verbatim)

- `investigator/handler.mjs` — evidence-cred load `607–648`; env+prompt+spawn `649–669`; analysis sidecar read `787–796`; sidecar upload `986–993`; cred cleanup `1090–1098`; `fullstoryUrl` destructure `387`, in `input` `413`, into `buildPrompt` `668`.
- `investigator/prompt.mjs` — `buildPrompt({ appId, feedback, fullstoryUrl, timeWindow })` `33–48`.
- `investigator/evidence-loader.mjs` — `entries` array `60–67` (Langfuse/FullStory secrets), return shape `42–50`.
- `investigator/Dockerfile` — `dnf install` `22–29`; CLI install `44–45`; COPY handler files `71–73`.
- `investigator/skills/airo-log-investigate/search_frontend_logs.py` — `LogSource` `73–131`; `LOG_SOURCES` `134–207`; `signature_for` `(masker)`; `_loki_env`/`_loki_merged_query` `895–903`; Loki consts `906–923`; `_fetch_loki_bucket` `926–1018`; `_fetch_loki_all_sources` `1021–1132`; ES `_es_app_id_query` `1239–1244`, `_fetch_es_paginated` `1247–1318`, `_fetch_es_source`/`_es_control_plane_index` `1321–1344`; Langfuse `703–711,1137–1234`; FullStory `695–702,1349–1605`; `build_index` `463–548`; `_build_source_result` `867–890`; `_enrich_source_index` `1608–1670`; `fetch_direct_evidence` `1673–1738`; `run` `1741–1802`; `main` `1827–1850`; `parse_window` `241–257`.
- `investigator/frontend_log_search_test.py` — unittest, importlib load `1–18`; fullstory test `82–89`; multi-source test `46`; index test `221–245`.
- `cdk/lib/investigator-stack.ts` — env `242–297`; inline IAM `160–196`; `addToRolePolicy` CRM `307–321` + evidence `325–340`; image asset `209–230`; memory/timeout `231–241`.
- `debug-console/src/app/api/investigate/route.ts` — POST `42–184`; jomax extract `65–68`; invoke payload `125–144`.
- `debug-console/src/components/InvestigatePanel.tsx` — form state `156–160`; fullstory field `722–731`; submit body `525–535`; report block `871–998`; cost `1000–1017`.
- `debug-console/src/lib/investigate/types.ts` — `InvestigationState` `14–67`; events `113–135`; `InvestigationSummary` `199–226`.
- `debug-console/src/lib/investigate/summaries.ts` — `AnalysisOverlay` `16–21`; `readAnalysis` `198–230`; `buildSummary` `46–97`.
- `debug-console/src/lib/agent-jwt.ts` — claims `169–188` (`iss:'airo-app'`, `aud:'agents-service'`, `siteId:appId`, `canDownload`, `authType:'basic'`); key source: Secrets Manager `JWT_SECRETS_NAME` (`keys[]`, pick `status==='active'`) or static `AGENT_JWT_PRIVATE_KEY`+`AGENT_JWT_KEY_ID`.
- agents routes the token reaches: `GET /apps/:id/zip` (requires `canDownload`), `GET /agent/conversations/:appId`, `GET /agent/conversations/:appId/:id`.

**Run tests:**
- Python skill: `cd investigator && python3 -m pytest frontend_log_search_test.py -v`
- Investigator Node: `cd investigator && node --test` (`*.test.mjs`)
- debug-console: `pnpm --filter debug-console test "<pattern>"`
- CDK: `pnpm --filter <cdk-pkg> test` (confirm filter via `cdk/package.json`)

---

## Milestone 0 — De-risking spikes (resolve before dependent milestones)

Two spikes gate exact code in M3 (graph + MCP) and M0.3 gates M1 (Loki fields). Each spike is a real, committable artifact, not a placeholder. The architecture is **decided** (same-base multi-stage `pip install --target` + stdio MCP, keeping code-review-graph + drain3); the spike *verifies* it and pins two unknowns (the `dnf` python version + the MCP entrypoint command name).

### Task 0.1: Spike — verify same-base multi-stage python + code-review-graph MCP in-container

**Files:**
- Create: `investigator/docker/spike-pydeps.Dockerfile`
- Create: `investigator/docker/spike-mcp-smoke.sh`
- Create: `docs/superpowers/notes/2026-06-02-investigate-pydeps-mcp-spike.md`

- [ ] **Step 1: Write the multi-stage spike Dockerfile (the real pattern, not naive pip)**

```dockerfile
# investigator/docker/spike-pydeps.Dockerfile
# Verifies the production pattern: build python deps in a same-base build
# stage with `pip install --target`, COPY into a clean runtime stage, and
# confirm import + tree-sitter parse + the code-review-graph MCP server start.
ARG LAMBDA_BASE_REPO=public.ecr.aws/lambda/nodejs
ARG LAMBDA_BASE_TAG=22

FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG} AS pybuild
# Confirm which python `dnf` actually provides. Try 3.11; if it 404s, the
# note records the real version and both stages switch to it.
RUN dnf install -y python3.11 python3.11-pip gcc gcc-c++ make && dnf clean all
RUN python3.11 -m pip install --target /opt/py-packages code-review-graph drain3

FROM ${LAMBDA_BASE_REPO}:${LAMBDA_BASE_TAG}
RUN dnf install -y python3.11 git && dnf clean all
COPY --from=pybuild /opt/py-packages /opt/py-packages
ENV PYTHONPATH=/opt/py-packages
RUN npm install -g @anthropic-ai/claude-code@2.1.131
# Import + tree-sitter parse smoke (no network)
RUN python3.11 - <<'PY'
import drain3; print("drain3 OK")
import code_review_graph; print("crg import OK")
# discover the MCP entrypoint module/console-script name for the note:
import importlib, pkgutil
print("crg submodules:", [m.name for m in pkgutil.iter_modules(code_review_graph.__path__)])
PY
```

- [ ] **Step 2: Write the MCP smoke script**

```bash
# investigator/docker/spike-mcp-smoke.sh
#!/bin/bash
set -euo pipefail
# Confirms the bundled CLI honors --mcp-config and spawns the code-review-graph
# MCP server over stdio. Replace the command/args with whatever Step 1's
# submodule discovery showed (e.g. python3.11 -m code_review_graph.mcp, or a
# console-script under /opt/py-packages/bin).
cat > /tmp/mcp.json <<'JSON'
{ "mcpServers": { "crg": {
    "command": "python3.11",
    "args": ["-m", "code_review_graph.mcp"],
    "env": { "PYTHONPATH": "/opt/py-packages" } } } }
JSON
claude -p "List the MCP tools you can call. Return only their names." \
  --mcp-config /tmp/mcp.json \
  --model claude-sonnet-4-6 \
  --output-format stream-json --verbose --dangerously-skip-permissions \
  --max-turns 3
```

- [ ] **Step 3: Build + run**

Run: `cd investigator && docker build --platform linux/amd64 -f docker/spike-pydeps.Dockerfile -t inv-pydeps-spike . 2>&1 | tee /tmp/pydeps-spike.log`
Expected: "drain3 OK" + "crg import OK" + the submodule list (reveals the MCP entrypoint). Then `docker run --rm -e ANTHROPIC_BASE_URL=<gocode-test> -e ANTHROPIC_AUTH_TOKEN=<test> --entrypoint bash inv-pydeps-spike /var/task/... spike-mcp-smoke.sh` (or `docker run` with the script COPYed in) and confirm the CLI lists the code-review-graph tool names.

- [ ] **Step 4: Record results + pin the two unknowns**

Write `docs/superpowers/notes/2026-06-02-investigate-pydeps-mcp-spike.md` with:
- the actual `dnf` python version (3.11 vs 3.9 vs other) — **M3.1 uses this version in both stages**;
- the exact MCP `command`/`args` that listed tools — **M3.2 `writeMcpConfig` uses this**;
- the final image size (`docker images inv-pydeps-spike`);
- **fallback only if multi-stage import fails:** flip to `public.ecr.aws/lambda/python:3.12` base + `dnf install nodejs` + `npm i -g` the CLI (python-native). **fallback only if stdio spawn fails under UID 1001:** start the MCP server as a localhost HTTP server in `bootstrap()` and use the `url` transport in `mcp.json`. Pick + record only if the primary path fails.

- [ ] **Step 5: Commit**

```bash
git add investigator/docker/spike-pydeps.Dockerfile investigator/docker/spike-mcp-smoke.sh docs/superpowers/notes/2026-06-02-investigate-pydeps-mcp-spike.md
git commit -m "spike(investigate): verify multi-stage python + code-review-graph MCP in-container"
```

> Task 0.2 (separate MCP spike) is folded into 0.1 above — the same image proves both the python deps and the MCP-over-stdio path.

### Task 0.3: Spike — confirm Loki structured-metadata `app_id` + field names

**Files:**
- Create: `docs/superpowers/notes/2026-06-02-investigate-loki-labels-spike.md`

- [ ] **Step 1: Query Loki for the new label/stream schema**

Using an operator Loki token (via the console's Grafana Explore or `logcli`), capture for a known prod appId:
- the working selector: `{env="prod",plane="data",service_name="airo-preview-application",cluster="c24"} | app_id="<id>"`
- the label set present under `plane="data"` and `plane="control"` (service_name values incl `airo-db-init`, `airo-pre-start`, mgmt streams)
- the level field name in structured metadata (`detected_level` vs `level`) — run `sum by (detected_level)(count_over_time({env="prod",plane="data"} | app_id="<id>" [1h]))` and a `level` variant; record which returns groups.
- the cutover timestamp: earliest time `| app_id=` returns rows (the ~1-day rollout boundary).

- [ ] **Step 2: Record** the exact label keys, the level field name, the full useful `service_name` list, and the cutover ISO date in the note. M1 source-registry + query builder reads these.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-06-02-investigate-loki-labels-spike.md
git commit -m "spike(investigate): document loki structured-metadata app_id schema"
```

---

## Milestone 1 — Log pipeline modernization (Python skill)

Removes Langfuse + FullStory; switches Loki to structured-metadata `app_id`; adds server-side aggregation (Stage 1); adds template-mined digest (Stage 2/3) reusing/extending the existing masker; adds a drill tool (Stage 4); ES kept for frontend only.

### Task 1.1: Remove Langfuse + FullStory from the log skill

**Files:**
- Modify: `investigator/skills/airo-log-investigate/search_frontend_logs.py`
- Modify: `investigator/frontend_log_search_test.py`

- [ ] **Step 1: Update the failing test first — assert the sources are gone**

In `frontend_log_search_test.py`, replace `test_batched_evidence_payload_forwards_fullstory_url_when_set` (lines 82–89) and extend the registry test (line 46) with:

```python
    def test_langfuse_and_fullstory_sources_are_removed(self):
        self.assertNotIn("langfuse", search_frontend_logs.LOG_SOURCES)
        self.assertNotIn("fullstory", search_frontend_logs.LOG_SOURCES)
        with self.assertRaises(ValueError):
            search_frontend_logs.get_log_source("langfuse")

    def test_direct_evidence_has_no_langfuse_or_fullstory_sources(self):
        with mock.patch.object(search_frontend_logs, "_fetch_loki_all_sources",
                               return_value={"airo-agents": {"sourceId": "airo-agents", "complete": True, "index": {}, "rawPages": []},
                                             "airo-preview": {"sourceId": "airo-preview", "complete": True, "index": {}, "rawPages": []},
                                             "airo-publish": {"sourceId": "airo-publish", "complete": True, "index": {}, "rawPages": []}}), \
             mock.patch.object(search_frontend_logs, "_fetch_es_source",
                               return_value={"sourceId": "airo-app-frontend", "complete": True, "index": {}, "rawPages": []}):
            data = search_frontend_logs.fetch_direct_evidence("app123", "24h", None, 5)
        ids = {s.get("sourceId") for s in data["sources"]}
        self.assertNotIn("langfuse", ids)
        self.assertNotIn("fullstory", ids)
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd investigator && python3 -m pytest frontend_log_search_test.py -k "langfuse_and_fullstory or no_langfuse" -v`
Expected: FAIL (langfuse/fullstory still present; `fetch_direct_evidence` still calls them).

- [ ] **Step 3: Delete the Langfuse + FullStory code**

In `search_frontend_logs.py`, delete: `LOG_SOURCES["langfuse"]` (186–195) and `["fullstory"]` (197–206); constants `695–711`; `_fetch_langfuse_trace_detail` (1137–1141), `_fetch_langfuse_all` (1144–1234); `_fullstory_mcp_call` (1349–1424), `_parse_fullstory_url` (1427–1443), `_parse_event_line_offset` (1446–1454), `_normalize_fullstory_events` (1457–1494), `_fetch_fullstory_all` (1497–1605). Remove `build_investigate_evidence_payload`'s `fullstory_url` param (303–317) — drop the param + the `if fullstory_url` block.

- [ ] **Step 4: Update `fetch_direct_evidence` (1673–1738)** — drop langfuse/fullstory futures, results, enrich calls, and `sources` entries, and drop the `fullstory_url` parameter:

```python
def fetch_direct_evidence(app_id: str, window_label: str, timeout: int) -> dict[str, Any]:
    window = parse_window(window_label)
    start_iso = window.start
    end_iso = window.end
    bucket_hours = None
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        loki_future = pool.submit(_fetch_loki_all_sources, app_id, window, bucket_hours, timeout)
        es_airo_future = pool.submit(
            _fetch_es_source, app_id,
            "AIRO_BUILDER_ES_ENDPOINT", "AIRO_BUILDER_ES_API_KEY",
            "logs-*", "data.appId", "airo-app-frontend",
            start_iso, end_iso, timeout,
        )
        loki_by_source = loki_future.result()
        es_airo_result = _enrich_source_index(es_airo_future.result(), app_id, window)
    sources = [
        loki_by_source["airo-agents"],
        loki_by_source["airo-preview"],
        loki_by_source["airo-publish"],
        loki_by_source.get("control-plane"),
        es_airo_result,
    ]
    sources = [s for s in sources if s]
    return {"appId": app_id, "timeWindow": window_label,
            "complete": all(s.get("complete", False) for s in sources), "sources": sources}
```

(Control-plane is now Loki-sourced — added in Task 1.3. ES control-plane future is removed here.)

- [ ] **Step 5: Update `run()` + `main()`** — remove `--fullstory-url` (line 1833), drop `fullstory_url` from the `fetch_direct_evidence` call (1758–1760) and the proxy `build_investigate_evidence_payload` call (1772–1774), and set `--sources` default (1831) to `"airo-app-frontend,airo-agents,airo-preview,airo-publish,control-plane"`.

- [ ] **Step 6: Run — verify pass**

Run: `cd investigator && python3 -m pytest frontend_log_search_test.py -v`
Expected: PASS (the removed fullstory test is gone; new removal tests pass; remaining tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add investigator/skills/airo-log-investigate/search_frontend_logs.py investigator/frontend_log_search_test.py
git commit -m "feat(investigate): remove langfuse + fullstory from log skill"
```

### Task 1.2: Remove Langfuse/FullStory creds from handler + evidence-loader

**Files:**
- Modify: `investigator/evidence-loader.mjs`
- Modify: `investigator/handler.mjs`
- Modify: `investigator/evidence-loader.test.mjs`

- [ ] **Step 1: Update the failing test** — `evidence-loader.test.mjs` should assert the returned object has no langfuse/fullstory keys and only requires Loki + ES secret envs. Add:

```javascript
test('loadEvidenceCredentials returns only loki + es keys', async () => {
  process.env.LOKI_API_KEY_SECRET = 's/loki';
  process.env.AIRO_BUILDER_ES_API_KEY_SECRET = 's/es';
  // (mock SecretsManager send to return SecretString per id)
  const creds = await loadEvidenceCredentials();
  assert.deepEqual(Object.keys(creds).sort(), ['airoBuilderEsApiKey', 'lokiApiKey']);
});
```

- [ ] **Step 2: Run — fails** (`cd investigator && node --test evidence-loader.test.mjs`). Expected: FAIL.

- [ ] **Step 3: Edit `evidence-loader.mjs`** — `entries` (60–67) becomes:

```javascript
      const entries = [
        ['LOKI_API_KEY_SECRET', 'lokiApiKey'],
        ['AIRO_BUILDER_ES_API_KEY_SECRET', 'airoBuilderEsApiKey'],
      ];
```

Update the JSDoc return shape (42–50) to `{ lokiApiKey, airoBuilderEsApiKey }`.

- [ ] **Step 4: Edit `handler.mjs`** — in the `source === 'feedback'` block (610–616) keep only:

```javascript
        process.env.LOKI_API_KEY = creds.lokiApiKey;
        process.env.AIRO_BUILDER_ES_API_KEY = creds.airoBuilderEsApiKey;
        process.env.INVESTIGATION_DIRECT_MODE = 'true';
```

In the `finally` cleanup (1090–1098) delete only `JOMAX_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `INVESTIGATION_DIRECT_MODE`, `LOKI_API_KEY`, `AIRO_BUILDER_ES_API_KEY` (drop the Langfuse/FullStory/control-plane-ES deletes).

- [ ] **Step 5: Run — pass** (`cd investigator && node --test`). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add investigator/evidence-loader.mjs investigator/evidence-loader.test.mjs investigator/handler.mjs
git commit -m "feat(investigate): drop langfuse/fullstory/control-plane-es creds from handler"
```

### Task 1.3: Loki structured-metadata `app_id` + control-plane via Loki + new streams

**Files:**
- Modify: `investigator/skills/airo-log-investigate/search_frontend_logs.py`
- Modify: `investigator/frontend_log_search_test.py`

Uses field names confirmed in Task 0.3 (assume `detected_level` for the level metadata; `service_name`, `plane`, `cluster`, `env` labels). Add a cutover constant from the spike.

- [ ] **Step 1: Write failing tests for the new query builder**

```python
    def test_loki_query_uses_structured_metadata_app_id(self):
        q = search_frontend_logs._loki_selector(plane="data", app_id="vz1fwh04kk", env="prod")
        self.assertIn('plane="data"', q)
        self.assertIn('| app_id="vz1fwh04kk"', q)
        self.assertNotIn('|=', q)  # no JSON line-substring match

    def test_loki_query_falls_back_to_line_match_before_cutover(self):
        # window starting before the structured-metadata rollout uses |= match
        q = search_frontend_logs._loki_selector(plane="data", app_id="x", env="prod",
                                                use_structured_metadata=False)
        self.assertIn('|= "\\"app_id\\":\\"x\\""', q)

    def test_control_plane_is_a_loki_source(self):
        self.assertIn("control-plane", search_frontend_logs.LOG_SOURCES)
        self.assertEqual(search_frontend_logs.LOG_SOURCES["control-plane"].backend_type, "loki")
```

- [ ] **Step 2: Run — fails.** `cd investigator && python3 -m pytest frontend_log_search_test.py -k loki_query -v`. Expected: FAIL (`_loki_selector` undefined).

- [ ] **Step 3: Add the selector builder + cutover constant** (replace `_loki_merged_query` 895–903):

```python
# Structured-metadata `app_id` shipped to prod Loki on this date (Task 0.3
# spike). For windows starting before it, fall back to the legacy JSON
# line-substring match so historical investigations still resolve.
LOKI_STRUCTURED_METADATA_CUTOVER = "2026-06-01T00:00:00Z"  # set from spike 0.3

def _loki_env() -> str:
    return "prod" if (os.environ.get("ENVIRONMENT_NAME", "dev") == "prod") else "dev"

def _loki_selector(plane: str, app_id: str, env: str, *,
                   cluster: str | None = None,
                   service_name_re: str | None = None,
                   use_structured_metadata: bool = True) -> str:
    labels = [f'env="{env}"', f'plane="{plane}"']
    if cluster:
        labels.append(f'cluster="{cluster}"')
    if service_name_re:
        labels.append(f'service_name=~"{service_name_re}"')
    sel = "{" + ",".join(labels) + "}"
    if use_structured_metadata:
        return f'{sel} | app_id="{app_id}"'
    return f'{sel} |= "\\"app_id\\":\\"{app_id}\\""'
```

**CONFIRMED SCHEMA (Grafana, prod):** level field = `detected_level`; cluster label format = `c24`; data-plane `service_name` regex `airo-(agents|preview-application|publish-application)`. **`cluster` + `service_name` scoping is MANDATORY** — without `cluster`, a query scans ~386 GiB/hour (unusable); with it, ~1.5 GiB (fast). `cluster` is read from the `LOKI_CLUSTER` env var (set by the handler — next step). Every Loki query (selector + aggregation + drill) MUST pass `cluster`.

- [ ] **Step 4: Add `control-plane` + new data-plane streams to `LOG_SOURCES`** (replace the old `control-plane` ES entry; add db-init/pre-start coverage via the data-plane `service_name` regex used by the Loki fetch — no per-stream registry rows needed since one merged query spans them). Set `control-plane` `backend_type="loki"`. Keep `airo-agents/airo-preview/airo-publish` rows. Keep `airo-app-frontend` (ES).

- [ ] **Step 5: Rewrite `_fetch_loki_all_sources` (1021–1132)** to run two merged queries — one per plane — using `_loki_selector` with `cluster=os.environ.get("LOKI_CLUSTER") or None`, decide `use_structured_metadata` by comparing the window start to `LOKI_STRUCTURED_METADATA_CUTOVER`, and split results by `service_name` (not `job`). Data plane regex: `"airo-agents|airo-preview-application|airo-publish-application|airo-db-init|airo-pre-start"`; control plane: `plane="control"` streams. Map `service_name → sourceId` (`airo-preview-application→airo-preview`, etc.; unknown data-plane names → `airo-agents` bucket). Return dict includes `"control-plane"`. If `LOKI_CLUSTER` is unset, log a warning + return empty-but-shaped results (skip the unbounded scan) so the run degrades to ES/code/convos rather than scanning 386 GiB.

- [ ] **Step 5b: Handler sets `LOKI_CLUSTER` from `agentUrl`.** In `investigator/handler.mjs`, port `extractClusterFromUrl` (from `debug-console/src/lib/investigate/evidence.ts:218` — parses `<appId>.<service>.<cluster>.airoapp.ai`) as a tiny local helper; when `agentUrl` is present, set `process.env.LOKI_CLUSTER = extractClusterFromUrl(agentUrl) ?? ''` before spawn, and delete it in the `finally` cleanup. Add a unit test for the parse (`https://x.preview.c24.airoapp.ai` → `c24`; junk → null). This is why `agentUrl` is in the payload — no separate cluster field needed.

- [ ] **Step 6: Run — pass.** `cd investigator && python3 -m pytest frontend_log_search_test.py -v`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add investigator/skills/airo-log-investigate/search_frontend_logs.py investigator/frontend_log_search_test.py
git commit -m "feat(investigate): loki structured-metadata app_id + control-plane via loki"
```

### Task 1.4: Stage-1 server-side aggregation digest

**Files:**
- Modify: `investigator/skills/airo-log-investigate/search_frontend_logs.py`
- Modify: `investigator/frontend_log_search_test.py`

- [ ] **Step 1: Failing test for the aggregation query + parse**

```python
    def test_loki_aggregation_query_shape(self):
        q = search_frontend_logs._loki_agg_query(plane="data", app_id="x", env="prod", window_s="1h")
        self.assertIn("sum by (service_name, detected_level)", q)
        self.assertIn("count_over_time(", q)
        self.assertIn("[1h]", q)

    def test_parse_agg_response_to_histogram(self):
        resp = {"data": {"result": [
            {"metric": {"service_name": "airo-preview-application", "detected_level": "error"}, "value": [0, "1240"]},
            {"metric": {"service_name": "airo-preview-application", "detected_level": "warn"}, "value": [0, "310"]},
        ]}}
        hist = search_frontend_logs._parse_loki_agg(resp)
        self.assertEqual(hist[("airo-preview-application", "error")], 1240)
```

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Implement** `_loki_agg_query(plane, app_id, env, window_s)` → `sum by (service_name, detected_level) (count_over_time(<selector>[<window_s>]))` and `_parse_loki_agg(resp)` → `dict[(service_name, level), int]` reading `data.result[].metric` + `value[1]`. Use Loki `/loki/api/v1/query` (instant) endpoint. Add a `_collect_aggregation(app_id, window, env)` that runs the data- and control-plane agg queries and returns a compact dict `{levelHistogram, byService, windowLabel}`.

- [ ] **Step 4: Wire the digest into `fetch_direct_evidence`** — call `_collect_aggregation` and attach the result as a top-level `"aggregation"` key on the returned bundle (so the TOON renderer + phase-0 show it first).

- [ ] **Step 5: Run — pass.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add investigator/skills/airo-log-investigate/search_frontend_logs.py investigator/frontend_log_search_test.py
git commit -m "feat(investigate): stage-1 server-side loki aggregation digest"
```

### Task 1.5: Stage-2/3 template-mined digest (drain3)

drain3 is installed via the M3.1 multi-stage `--target` copy (same mechanism as code-review-graph), so it is available at runtime. `mine_templates` wraps it.

**Files:**
- Modify: `investigator/skills/airo-log-investigate/search_frontend_logs.py`
- Modify: `investigator/frontend_log_search_test.py`

- [ ] **Step 1: Failing test for template mining**

```python
    def test_mine_templates_collapses_variants(self):
        lines = [
            "Failed to load product 8842 for user alice",
            "Failed to load product 1190 for user bob",
            "Failed to load product 3375 for user carol",
        ]
        templates = search_frontend_logs.mine_templates(lines)
        self.assertEqual(len(templates), 1)
        t = templates[0]
        self.assertEqual(t["count"], 3)
        self.assertIn("<*>", t["template"])
        self.assertGreaterEqual(len(t["examples"]), 1)
```

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Implement `mine_templates(lines)`** returning `[{template, count, examples[≤2]}]` by wrapping `drain3.TemplateMiner`: feed each line via `add_log_message`, then read `miner.drain.clusters` → `{template: c.get_template(), count: c.size, examples}` (keep ≤2 raw examples per cluster). drain3 is on `PYTHONPATH` (M3.1). The test imports `mine_templates`; if drain3 is unavailable in the local test env, guard the import and fall back to grouping by the existing `LogSource.signature_for` masker so unit tests run without the dep (production always has drain3 via the image).

- [ ] **Step 4: Build the Stage-3 digest** — add `build_log_digest(bundle)` that combines Stage-1 aggregation + per-source `mine_templates` over error/warn sampled lines + verbatim rare-error lines (reuse `build_index`'s `rareErrorSignatures`, count ≤ 3, emitted verbatim). Attach as `bundle["digest"]`. Update `render_batched_toon` to print the digest first.

- [ ] **Step 5: Run — pass.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add investigator/skills/airo-log-investigate/search_frontend_logs.py investigator/frontend_log_search_test.py
git commit -m "feat(investigate): stage-2/3 template-mined log digest"
```

### Task 1.6: Stage-4 drill-on-demand tool

**Files:**
- Create: `investigator/skills/airo-log-investigate/fetch_log_lines.py`
- Create: `investigator/skills/airo-log-investigate/fetch_log_lines.sh`
- Modify: `investigator/frontend_log_search_test.py`

- [ ] **Step 1: Failing test** — assert `fetch_log_lines` builds a `_loki_selector` query scoped to a service + line filter and returns raw lines (mock `_http_get_json`).

```python
    def test_fetch_log_lines_filters_by_template_substring(self):
        with mock.patch.object(search_frontend_logs, "_http_get_json",
                               return_value={"data": {"result": [
                                   {"stream": {"service_name": "airo-preview-application"},
                                    "values": [["1", "ECONNREFUSED 10.0.0.2"]]}]}}):
            lines = search_frontend_logs.fetch_log_lines(
                app_id="x", plane="data", service_name="airo-preview-application",
                contains="ECONNREFUSED", window="1h", env="prod", limit=50)
        self.assertEqual(lines[0]["line"], "ECONNREFUSED 10.0.0.2")
```

(Put `fetch_log_lines` in `search_frontend_logs.py` so the test imports it; the `.py`/`.sh` wrappers below are the agent-facing entrypoint.)

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Implement `fetch_log_lines(...)`** in `search_frontend_logs.py` — builds `_loki_selector(...)` + optional `|= "<contains>"`, hits `/loki/api/v1/query_range` with `limit`, returns `[{ts, line, service_name}]`. Add a thin CLI in `fetch_log_lines.py` (argparse: `--appId --plane --service --contains --window --limit`) that imports the function and prints JSON, plus `fetch_log_lines.sh` mirroring `run_search_frontend_logs.sh` (LD_LIBRARY_PATH + `exec python3`).

- [ ] **Step 4: Run — pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add investigator/skills/airo-log-investigate/fetch_log_lines.py investigator/skills/airo-log-investigate/fetch_log_lines.sh investigator/skills/airo-log-investigate/search_frontend_logs.py investigator/frontend_log_search_test.py
git commit -m "feat(investigate): stage-4 fetch_log_lines drill-on-demand tool"
```

---

## Milestone 2 — Customer code + conversations (handler, agent-token auth)

### Task 2.1: Port the agents JWT minter to the Lambda

**Files:**
- Create: `investigator/agent-jwt.mjs`
- Create: `investigator/agent-jwt.test.mjs`
- Modify: `investigator/Dockerfile` (COPY list line 71–73)

- [ ] **Step 1: Failing test** — static-key mint produces a 3-part JWT with the right claims.

```javascript
import test from 'node:test';
import assert from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import { mintAgentToken, _resetAgentJwtForTest } from './agent-jwt.mjs';

test('mintAgentToken signs RS256 with agents-service claims', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.AGENT_JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' });
  process.env.AGENT_JWT_KEY_ID = 'test-kid';
  delete process.env.JWT_SECRETS_NAME;
  _resetAgentJwtForTest();
  const { token } = await mintAgentToken({ appId: 'app123', canDownload: true });
  const [, payloadB64] = token.split('.');
  const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  assert.equal(claims.iss, 'airo-app');
  assert.equal(claims.aud, 'agents-service');
  assert.equal(claims.siteId, 'app123');
  assert.equal(claims.canDownload, true);
  assert.equal(claims.authType, 'basic');
});
```

- [ ] **Step 2: Run — fails.** `cd investigator && node --test agent-jwt.test.mjs`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `agent-jwt.mjs`** — ESM port of `debug-console/src/lib/agent-jwt.ts` (claims object exactly per lines 169–188, including `isE2S:false`, `product:'AiroAppBuilder'`, etc.), reading the signing key from `JWT_SECRETS_NAME` (Secrets Manager, pick `keys[].status==='active'`) with static fallback (`AGENT_JWT_PRIVATE_KEY`+`AGENT_JWT_KEY_ID`). Use `node:crypto` `createSign('RSA-SHA256')`. Export `mintAgentToken({appId, canDownload, canPublish, canPurchaseDomain})` + `_resetAgentJwtForTest()`. 5-min key cache like the source.

- [ ] **Step 4: Add to Dockerfile COPY** (line 71–73): append `agent-jwt.mjs` to the `COPY handler.mjs auth.mjs ...` list.

- [ ] **Step 5: Run — pass.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add investigator/agent-jwt.mjs investigator/agent-jwt.test.mjs investigator/Dockerfile
git commit -m "feat(investigate): port agents-service JWT minter to lambda"
```

### Task 2.2: Fetch + unzip app code; fetch conversations

**Files:**
- Create: `investigator/agent-fetch.mjs`
- Create: `investigator/agent-fetch.test.mjs`
- Modify: `investigator/Dockerfile` (COPY list)

- [ ] **Step 1: Failing test** — `fetchAppZip` writes to a dir; `fetchConversations` returns parsed JSON. Mock `fetch` (Node 22 global) to return a tiny zip buffer + a conversations payload; assert files land + JSON parses.

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Implement `agent-fetch.mjs`** — `fetchAppZip({agentUrl, appId, token, destDir})` GETs `${agentUrl}/apps/${appId}/zip` with `Authorization: Bearer ${token}`, streams to `${destDir}/app.zip`, unzips to `${destDir}/app/` via `unzip` (`child_process`; `unzip` is added to the runtime `dnf install` in M3.1 Step 2). `fetchConversations({agentUrl, appId, token})` GETs `${agentUrl}/agent/conversations/${appId}` (+ details for the most recent N) and returns the JSON. Both soft-fail: return `{ ok: false, error }` rather than throw.

- [ ] **Step 4: Add `agent-fetch.mjs` to the Dockerfile COPY list** (the `COPY handler.mjs auth.mjs ...` line). (`unzip` is installed in M3.1 Step 2.)

- [ ] **Step 5: Run — pass.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add investigator/agent-fetch.mjs investigator/agent-fetch.test.mjs investigator/Dockerfile
git commit -m "feat(investigate): fetch app zip + agent conversations via agent token"
```

### Task 2.3: Wire code/convo fetch into the handler pre-spawn

**Files:**
- Modify: `investigator/handler.mjs`
- Modify: `investigator/handler.test.mjs`

- [ ] **Step 1: Failing test** — invoking the handler with `agentUrl` in the event mints a token, calls `fetchAppZip` + `fetchConversations`, and sets `REPORT_DIR`/`APP_CODE_DIR`/`CONVERSATIONS_PATH` env before spawn. Mock `agent-jwt` + `agent-fetch` + `spawnClaude`.

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Edit `handler.mjs`** — destructure `agentUrl` from `event` (near 382–397). After the evidence-cred block and before `spawnClaude` (≈649–669): mint `agentToken = await mintAgentToken({appId, canDownload:true})` (soft-fail → emit warning, continue logs-only); call `fetchAppZip` to `${workDir}/app` and `fetchConversations` to `${workDir}/conversations.json`; set `process.env.APP_CODE_DIR = ${workDir}/app` and `process.env.CONVERSATIONS_PATH = ${workDir}/conversations.json` when present. Each failure emits an `investigation.warning` and a `mergeState` note (mirror the evidence-creds soft-degrade pattern at 618–647), never hard-fails.

- [ ] **Step 4: Run — pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add investigator/handler.mjs investigator/handler.test.mjs
git commit -m "feat(investigate): handler fetches app code + conversations pre-spawn"
```

---

## Milestone 3 — code-review-graph (platform + customer), MCP over stdio — gated on spike 0.1

Uses the **same-base multi-stage `pip install --target` + stdio MCP** design (spec §3), verified in Task 0.1. Substitute the python version + MCP entrypoint command recorded in the 0.1 note. Only if 0.1's primary path failed do you switch to the recorded fallback (python-base image / HTTP MCP), keeping the same task boundaries.

### Task 3.1: Multi-stage image — python deps ONLY (no platform bake)

**Status: DONE then REVISED.** The image multi-stage (python3.11 + code-review-graph + drain3 via `--target`, `LD_LIBRARY_PATH=/usr/lib64` both stages) is implemented + verified (commits `b8ab66cea`, `8731738ca`, `d49d7e00d`). The platform-graph is **no longer baked** (superseded by Task 3.3 S3 design) — the image carries only the python deps + the customer-graph capability. The Dockerfile's platform-bake lines + `build-platform-graph.sh` are removed/repurposed by Task 3.3 below.

Confirmed CLI (spike + image inspection, no creds): `code-review-graph build --repo <dir> --skip-flows` (minimal); `code-review-graph serve` (stdio MCP). Image ≈1.62 GB; deps import; customer build verified (68 nodes/799 edges + FTS).

### Task 3.3: Platform graph — scheduled GitHub Actions builder → S3 → runtime load

Supersedes the image bake. The platform graph covers `agents/` + `app/` + `app-templates/`, refreshed 2×/day, loaded by the Lambda from S3.

**Files:**
- Create: `.github/workflows/refresh-platform-graph.yml`
- Create: `investigator/platform-graph.mjs` + `investigator/platform-graph.test.mjs`
- Modify: `investigator/handler.mjs` (call `ensurePlatformGraph` pre-spawn; platform repo_root = `/tmp/platform-graph`)
- Modify: `investigator/Dockerfile` (REMOVE the platform-bake stage lines + the `COPY --from=pybuild /opt/platform-graph` — keep the python-deps `--target` copy)
- Modify: `cdk/lib/investigator-stack.ts` (investigator role: S3 read on `platform-graph/*`; builder OIDC role: S3 write on `platform-graph/*`)

- [ ] **Step 1 — GH Actions builder** `.github/workflows/refresh-platform-graph.yml`:
  - `on: schedule: [{cron: "23 6,18 * * *"}]` + `workflow_dispatch`.
  - Checkout `main`; `dnf`/`apt` python3.11 + `pip install code-review-graph`.
  - **Compose a source-only root** (efficiency + excludes): `mkdir /tmp/platform-src && rsync -a --prune-empty-dirs agents/src app/src app-templates /tmp/platform-src/` EXCLUDING `node_modules`, `dist`, `.next`, `build`, `out`, `coverage`, `.git`, `*.min.*`, `*.lock`, generated. (code-review-graph also honors `.gitignore`.)
  - **Incremental:** restore the prior `graph.db` from `actions/cache` keyed on a rolling key; if present, `code-review-graph update --repo /tmp/platform-src` (incremental) else `code-review-graph build --repo /tmp/platform-src --skip-flows`. Save cache.
  - **Conditional upload:** `sha256sum` the new `graph.db`; compare to the last uploaded hash (store alongside in S3 or in cache); skip `aws s3 cp` if unchanged. Else upload `graph.db` (+ the hash) to `s3://${STATE_BUCKET}/platform-graph/graph.db` via the existing OIDC role (id-token write).
  - Use the same runner/OIDC pattern as the existing `aws-deploy-*` workflows.

- [ ] **Step 2 — `platform-graph.mjs`** `ensurePlatformGraph()`:
  - S3 `HeadObject` on `platform-graph/graph.db`; compare ETag to a module-cached value (warm-container cache). If unchanged + file present, return `/tmp/platform-graph`.
  - Else `GetObject` → write to `/tmp/platform-graph/.code-review-graph/graph.db`, cache the ETag, return `/tmp/platform-graph`.
  - Soft-fail (missing object / S3 error) → return `null` (platform graph unavailable; Read/Grep + customer graph still serve). Export `_resetForTest()`.
  - Unit test: mock the S3 client — fresh download writes the file + returns the root; unchanged ETag skips download; missing object → null.

- [ ] **Step 3 — handler wiring:** before spawn, `const platformGraphRoot = await ensurePlatformGraph()` (soft-fail → warning, continue). The agent/prompt is told platform `repo_root=/tmp/platform-graph` (when present) + customer `repo_root=/tmp/<id>/app`. `writeMcpConfig` already runs gated on `isGraphAvailable()` (deps present); MCP `serve` exposes the tools, which take `repo_root` per call.

- [ ] **Step 4 — Dockerfile:** remove the pybuild platform-bake lines (`COPY . /opt/platform-src`, the `build-platform-graph.sh` run, `rm -rf`) and the runtime `COPY --from=pybuild /opt/platform-graph`. Keep the `--target` python-deps copy + `PYTHONPATH`. Delete/repurpose `investigator/docker/build-platform-graph.sh` (its logic moves to the workflow).

- [ ] **Step 5 — CDK:** investigator role gets `s3:GetObject` on `${stateBucket}/platform-graph/*`; the builder OIDC role (the GH Actions deploy role) gets `s3:PutObject` on `${stateBucket}/platform-graph/*`. (Reuse the existing bucket + role wiring patterns in `investigator-stack.ts`.)

- [ ] **Step 6 — verify + commit:** `cd investigator && npm test` green; `docker build` still succeeds (no bake step). Commit:
```bash
git add .github/workflows/refresh-platform-graph.yml investigator/platform-graph.mjs investigator/platform-graph.test.mjs investigator/handler.mjs investigator/handler.test.mjs investigator/Dockerfile investigator/docker/build-platform-graph.sh cdk/lib/investigator-stack.ts
git commit -m "feat(investigate): platform graph via scheduled GH Actions builder + S3 load"
```

### Task 3.2: Build the customer graph at runtime + write the MCP config

**Files:**
- Modify: `investigator/handler.mjs`
- Create: `investigator/graph-setup.mjs`
- Create: `investigator/graph-setup.test.mjs`

- [ ] **Step 1: Failing test** — `writeMcpConfig(outPath)` writes the exact stdio `mcpServers` JSON proven in spike 0.1 (`command`/`args`/`env.PYTHONPATH`); `buildCustomerGraph(dir)` shells the graph build (mock `child_process`).

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Implement `graph-setup.mjs`** — `buildCustomerGraph(appCodeDir)` runs the build for `repo_root=<dir>` with `postprocess=minimal` (exact command from spike 0.1; soft-fail → return false). `writeMcpConfig(outPath)` writes the stdio config verbatim from spike 0.1:

```json
{ "mcpServers": { "crg": {
    "command": "python3.11",
    "args": ["-m", "code_review_graph.mcp"],
    "env": { "PYTHONPATH": "/opt/py-packages" } } } }
```

where the JSON is the spike-0.1-pinned stdio config:

```json
{ "mcpServers": { "crg": {
    "command": "python3.11",
    "args": ["-m", "code_review_graph", "serve"],
    "env": { "PYTHONPATH": "/opt/py-packages", "LD_LIBRARY_PATH": "/usr/lib64" } } } }
```

(`-m code_review_graph serve` — NOT `code_review_graph.mcp`; `LD_LIBRARY_PATH` required. Confirm `serve` vs `mcp` against the deferred `spike-mcp-smoke.sh` creds run before relying on it.) In `handler.mjs`, after the app unzip (Task 2.3): call `buildCustomerGraph(${workDir}/app)` (soft-fail → warning + Read/Grep fallback) and `writeMcpConfig(${workDir}/mcp.json)`; extend `spawnClaude(prompt, logStream, mcpConfigPath)` to append `--mcp-config ${mcpConfigPath}` when present. The graph tools take `repo_root` per call, so the agent queries both `/tmp/<id>/app` (customer) and `/opt/platform-graph` (platform) through the one server.

- [ ] **Step 4: Run — pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add investigator/handler.mjs investigator/graph-setup.mjs investigator/graph-setup.test.mjs
git commit -m "feat(investigate): runtime customer graph + MCP config wired into CLI"
```

---

## Milestone 4 — Path unification + console trigger-only

### Task 4.1: Console route — drop JOMAX, pass agentUrl + source

**Files:**
- Modify: `debug-console/src/app/api/investigate/route.ts`
- Modify: `debug-console/src/app/api/investigate/route.test.ts` (or the colocated test)

- [ ] **Step 1: Failing test** — POST resolves `agentUrl` via `getAgentUrl(appId)` and the invoke payload includes `agentUrl` + `source:'console'` and NO `jomaxToken`/`fullstoryUrl`. Mock `mgmtControlPlaneAdapter.getAgentUrl` + `invokeInvestigator`.

- [ ] **Step 2: Run — fails.** `pnpm --filter debug-console test investigate/route`. Expected: FAIL.

- [ ] **Step 3: Edit `route.ts`** — remove the jomax extract + 401 (65–68). Resolve `const agentUrl = await mgmtControlPlaneAdapter.getAgentUrl(appId)` (soft-fail → 502 with `agent_url_unresolved`). Drop `fullstoryUrl` from `state.input` (88) and the invoke payload (130). Add `agentUrl` + `source: 'console'` to the `invokeInvestigator` payload (125–144); remove `jomaxToken`.

- [ ] **Step 4: Run — pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add debug-console/src/app/api/investigate/
git commit -m "feat(investigate): console trigger-only (agentUrl in payload, no JOMAX)"
```

### Task 4.2: Handler — make `source==='console'` use the direct path; drop fullstory/jomax requirements

**Files:**
- Modify: `investigator/handler.mjs`
- Modify: `investigator/handler.test.mjs`

- [ ] **Step 1: Failing test** — a `source:'console'` event with `agentUrl` runs the same direct-evidence path (loads evidence creds, sets `INVESTIGATION_DIRECT_MODE`) and does NOT require `jomaxToken`.

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Edit `handler.mjs`** — remove the `jomaxToken` requirement (490–499) and the legacy `gocodeApiKey`/`source==='feedback'`-only gating around evidence creds: load evidence creds + set `INVESTIGATION_DIRECT_MODE='true'` for ALL sources (drop the `if (source === 'feedback')` guard at 607). Remove `fullstoryUrl` destructure (387), its `input` entry (413), and the `buildPrompt` arg (668). Remove `process.env.JOMAX_TOKEN` set (649) and its cleanup (1090) — no longer used.

- [ ] **Step 4: Run — pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add investigator/handler.mjs investigator/handler.test.mjs
git commit -m "feat(investigate): unify console+feedback on one direct path"
```

### Task 4.3: Remove the FullStory field from the panel + the script `--window` mapping

**Files:**
- Modify: `debug-console/src/components/InvestigatePanel.tsx`
- Modify: `investigator/prompt.mjs`
- Modify: `debug-console/src/lib/investigate/types.ts`

- [ ] **Step 1:** Remove `fullstoryUrl` state (159) + the FullStory field JSX (722–731) + `fullstoryUrl` from the submit body (532). Remove `fullstoryUrl` from `InvestigationInput` (types.ts 8–12) and `InvestigationSummary.fullstoryUrl` (210) — grep for other readers (`summaries.ts` builds `fullstoryUrl: state.input.fullstoryUrl`; set to remove).

- [ ] **Step 2:** Edit `prompt.mjs` `buildPrompt` (33–48) — drop the `fullstoryUrl` param + the trailing `${fs}`; update the `searchMode` copy to describe code + conversations + graph + log-digest sources (no fullstory/langfuse). Keep the untrusted-feedback block.

- [ ] **Step 3: Run typecheck + tests** — `pnpm --filter debug-console typecheck && pnpm --filter debug-console test investigate`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add debug-console/src/components/InvestigatePanel.tsx investigator/prompt.mjs debug-console/src/lib/investigate/types.ts debug-console/src/lib/investigate/summaries.ts
git commit -m "feat(investigate): remove fullstory field + prompt source"
```

---

## Milestone 5 — Verdict + copy-paste fix prompt

### Task 5.1: Extend the analysis sidecar contract (skill synthesis)

**Files:**
- Modify: `investigator/skills/airo-log-investigate/phases/phase-2-synthesis.md`
- Modify: `investigator/skills/airo-log-investigate/SKILL.md`
- Modify: `investigator/skills/airo-log-investigate/phases/phase-0-gather.md`
- Modify: `investigator/skills/airo-log-investigate/phases/phase-1-analyze.md`

- [ ] **Step 1:** In `phase-2-synthesis.md`, extend the `analysis.json` JSON contract (lines 15–35) to add the verdict + fix fields and keep the existing ones:

```json
{
  "v": 1,
  "sentiment": "negative",
  "confidence": 0.85,
  "rootCause": "<TL;DR sentence>",
  "category": "publish-failure",
  "verdict": "agent-bug",
  "relatesTo": "publish-pipeline",
  "verdictConfidence": "high",
  "verdictRationale": "<1-3 sentences citing evidence>",
  "fixKind": "app-prompt",
  "fixPrompt": "<copy-paste instruction for the develop-agent, or null>",
  "engNote": null
}
```

Document: `verdict ∈ {agent-bug, customer-error, platform-bug, external, no-issue}`; `fixKind ∈ {app-prompt, eng-note, none}`; `fixPrompt` set only when `fixKind==='app-prompt'` (names exact files/symbols from the graph); `engNote` set only when `verdict==='platform-bug'`; fail toward `no-issue`/`customer-error` on weak signals.

- [ ] **Step 2:** Update `SKILL.md` source table + remove langfuse/fullstory rows (42–43); update phase-0 (remove langfuse/fullstory from the source list; document the new code/convo/graph inputs + `fetch_log_lines`); update phase-1 (remove langfuse/fullstory bullets 19–22; add "default mental model: bug is in the customer app; escalate to platform graph on stack-trace/convo/log signals").

- [ ] **Step 3: Commit**

```bash
git add investigator/skills/airo-log-investigate/
git commit -m "feat(investigate): verdict + fix prompt in synthesis; refresh skill phases"
```

### Task 5.2: Consume verdict/fix in summaries + types

**Files:**
- Modify: `debug-console/src/lib/investigate/summaries.ts`
- Modify: `debug-console/src/lib/investigate/types.ts`
- Modify: the summaries test

- [ ] **Step 1: Failing test** — `readAnalysis` returns the new fields; `buildSummary` maps them onto the summary.

- [ ] **Step 2: Run — fails.** `pnpm --filter debug-console test summaries`. Expected: FAIL.

- [ ] **Step 3: Edit `summaries.ts`** — extend `AnalysisOverlay` (16–21) with `verdict, relatesTo, verdictConfidence, verdictRationale, fixKind, fixPrompt, engNote`; parse + validate them in `readAnalysis` (209–223) with an allowlist on `verdict`/`fixKind`; map onto the summary in `buildSummary` (90–93). Extend `InvestigationSummary` (types.ts 199–226) with the same fields.

- [ ] **Step 4: Run — pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add debug-console/src/lib/investigate/summaries.ts debug-console/src/lib/investigate/types.ts
git commit -m "feat(investigate): surface verdict + fix in investigation summary"
```

### Task 5.3: Render verdict badge + Copy-fix-prompt button

**Files:**
- Modify: `debug-console/src/components/InvestigatePanel.tsx`
- Modify: the status route(s) that feed the panel (`status`/`latest`) so the panel receives the analysis fields

- [ ] **Step 1: Failing test** — a status response carrying `verdict:'agent-bug'` + `fixPrompt` renders a badge + an enabled "Copy fix prompt" button; `verdict:'platform-bug'` renders the eng note and no copy button. (Component test with the panel's existing test harness.)

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Implement** — extend the panel's `StatusResponse` type with the analysis fields; ensure the `status`/`latest` API routes include them (read via `readAnalysis`). Add a verdict block above the report block (≈ before 871): colored badge by `verdict`, `relatesTo` + `verdictConfidence`, `verdictRationale`. When `fixKind==='app-prompt'`, render the `fixPrompt` in a `<pre>` with a "Copy fix prompt" button (reuse the existing `handleCopy` clipboard pattern at 882–898). When `eng-note`, render `engNote` as plain text; when `none`, render the explanation.

- [ ] **Step 4: Run — pass + typecheck.** Expected: PASS.

- [ ] **Step 5: E2E check** — grep `tests/e2e` + `tests/regression` for investigate `data-testid`s; add `data-testid="investigate-verdict"` + `"investigate-copy-fix"` and update any affected spec.

- [ ] **Step 6: Commit**

```bash
git add debug-console/src/components/InvestigatePanel.tsx debug-console/src/app/api/investigate/
git commit -m "feat(investigate): render verdict badge + copy-fix-prompt button"
```

---

## Milestone 6 — CDK (env, IAM, image)

### Task 6.1: Env cleanup + JWT secret read grant

**Files:**
- Modify: `cdk/lib/investigator-stack.ts`
- Modify: the stack's test (if present)

- [ ] **Step 1: Failing test (or snapshot)** — the synthesized template has a Secrets Manager `GetSecretValue` statement for the JWT signing secret and no longer sets the Langfuse/FullStory env vars. If the stack has a unit/snapshot test, update it; else add a `Template.fromStack` assertion.

- [ ] **Step 2: Run — fails.** Expected: FAIL.

- [ ] **Step 3: Edit `investigator-stack.ts`** —
  - Env block (242–297): remove `EB_LANGFUSE_BASE_URL`, `EB_LANGFUSE_PUBLIC_KEY_SECRET`, `EB_LANGFUSE_SECRET_KEY_SECRET`, `CONTROL_PLANE_ES_ENDPOINT`, `CONTROL_PLANE_ES_API_KEY_SECRET`, `FULLSTORY_API_KEY_SECRET`, `FULLSTORY_MCP_URL`. Keep `LOKI_*`, `AIRO_BUILDER_ES_*`. Add `JWT_SECRETS_NAME: config.jwtSecretsName` (+ the prop on the config type, pointing at the same secret app/ uses).
  - `EvidenceSecretsRead` (325–340): reduce `evidenceSecretPaths` to `[config.lokiApiKeySecret, config.airoBuilderEsApiKeySecret]`.
  - Add an `addToRolePolicy` statement `JwtSigningSecretRead` granting `secretsmanager:GetSecretValue` on `arn:...:secret:${config.jwtSecretsName}*`.

- [ ] **Step 4: Run — pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cdk/lib/investigator-stack.ts
git commit -m "feat(investigate): cdk env cleanup + JWT signing secret read grant"
```

### Task 6.2: Image/memory review for python deps + graph

**Files:**
- Modify: `cdk/lib/investigator-stack.ts` (memory/ephemeral if needed)

- [ ] **Step 1:** If spike 0.1/3.1 showed the image or graph build needs more headroom, bump `ephemeralStorageSize` (237) and confirm `memorySize` (235) still fits the 15-min cap. Record the measured image size in the stack comment.

- [ ] **Step 2: Run** the CDK test/synth. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add cdk/lib/investigator-stack.ts
git commit -m "chore(investigate): size lambda for python deps + graph"
```

---

## Milestone 7 — Retire troubleshooter + dead console-proxy evidence

### Task 7.1: Verify-then-remove the console-proxy evidence path

**Files:**
- Delete (after verification): `debug-console/src/lib/investigate/evidence.ts`, the `/api/es-logs` + `/api/investigate-evidence` routes (confirm exact paths)
- Modify: any caller revealed by the grep

- [ ] **Step 1: Verify no live consumers** — `git grep -n "investigate-evidence\|es-logs\|investigate/evidence" debug-console agents app`. Confirm only the (now-unused) console-proxy investigation path referenced them. List findings in the commit body.

- [ ] **Step 2:** Remove the proxy evidence collection + its routes + tests. Update `debug-console/CLAUDE.md` (the `src/lib/investigate/` line + the `es-logs` aggregator mention).

- [ ] **Step 3: Run** `pnpm --filter debug-console typecheck && pnpm --filter debug-console test`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add debug-console/
git commit -m "chore(investigate): remove dead console-proxy evidence path"
```

### Task 7.2: Delete the troubleshooter + its CI + agents support-JWT routes

**Files:**
- Delete: `troubleshooter/`, `.github/workflows/aws-deploy-troubleshooter.yml`
- Delete (after verification): `agents/src/server/routes/internal/workspace.ts`, `.../transcripts.ts`, and the `requireSupportTenantMatch`/`authType:'support'` plumbing added solely for it
- Modify: `agents/src/server/routes/internal/*` registration + tests; `promote-artifact` workflow (remove troubleshooter entry)

- [ ] **Step 1: Verify the agents support-JWT routes have no other consumers** — `git grep -n "requireSupportTenantMatch\|/workspace/\|/transcripts/\|authType.*support" agents debug-console`. The enhanced Investigate uses agent-token + `/apps/:id/zip` + `/agent/conversations` (NOT these), so they should be unreferenced outside their own tests. List findings.

- [ ] **Step 2:** Delete `troubleshooter/` + its workflow; remove the troubleshooter entry from `.github/workflows/promote-artifact.yml`. Remove the agents support-JWT internal routes + middleware + their registration + tests. Keep `agents/src/server/routes/internal/` routes that predate the troubleshooter (audit per grep).

- [ ] **Step 3: Run** `pnpm --filter @airo/agents test:unit "internal"` + `pnpm --filter @airo/agents typecheck`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: retire troubleshooter + support-JWT internal routes superseded by enhanced Investigate"
```

---

## Milestone 8 — End-to-end verification

### Task 8.1: Full suite + dev smoke

- [ ] **Step 1:** `cd investigator && python3 -m pytest frontend_log_search_test.py -v && node --test`. Expected: PASS.
- [ ] **Step 2:** `pnpm --filter debug-console typecheck && pnpm --filter debug-console lint && pnpm --filter debug-console test`. Expected: PASS.
- [ ] **Step 3:** Build the image locally: `cd investigator && docker build --platform linux/amd64 --build-arg LAMBDA_BASE_REPO=public.ecr.aws/lambda/nodejs --build-arg LAMBDA_BASE_TAG=22 -t investigate-local .`. Expected: builds, size recorded < 1.5 GiB (or the documented fallback).
- [ ] **Step 4:** Dev smoke — deploy to dev-private (manual workflow) and run one console "Investigate" on a known app: confirm the report cites code (graph/file refs) + a log digest, and the panel shows a verdict badge. Capture the run's `analysis.json` from S3 to confirm the new fields.
- [ ] **Step 5: Commit** any fixups from the smoke run.

---

## Self-review notes (coverage vs spec)

- Code reading (graph + file tools) → M3 + handler env (`APP_CODE_DIR`, MCP config). ✓
- Customer code/convo auth like console (agent JWT + zip + conversations) → M2. ✓
- Platform source pre-baked graph → Task 3.1. ✓
- Langfuse removed from Investigate, kept elsewhere → M1.1/1.2 + M6.1 (only investigator env touched; analytics/evals/exporter untouched). ✓
- FullStory removed → M1.1/1.2, 4.3, 6.1. ✓
- Loki structured-metadata + aggregation + template mining + drill + ES-frontend-only → M1.3–1.6. ✓
- One path (console+feedback) → M4. ✓
- Verdict + copy-paste fix → M5. ✓
- Retire troubleshooter + dead proxy → M7. ✓
- Soft-degrade per source → M2.3 (warnings + state notes), M1 (per-source `complete:false`). ✓
- Verification spikes (multi-stage python + stdio MCP; Loki fields) → M0. ✓

Architecture is decided: same-base multi-stage `pip install --target` + stdio code-review-graph MCP, keeping drain3. Spikes verify it and pin the `dnf` python version + MCP entrypoint command. Gated dependencies: M3 + M1.5 depend on spike 0.1 (python version + MCP command); M1.3/1.4/1.6 depend on spike 0.3 (Loki field names). Run M0 first.

---

## Iteration 2 — Quality (verifier) + Speed (parallelism, thinking)

SOTA gap-analysis (Anthropic "Building Effective Agents" + multi-agent research system): our single-agent + strong context-engineering core is correct; deliberately NOT adding orchestrator-worker fan-out (wrong fit for a cross-referencing investigation, ~15× cost). Two targeted additions:

### Task V1 — Verifier (evaluator pattern, fresh-context LLM-as-judge)

**Files:** Create `investigator/verifier.mjs` + `verifier.test.mjs`; modify `handler.mjs`; extend `summaries.ts`/`types.ts` + `InvestigatePanel.tsx` for `verifierNote`.

- After the main agent writes `report.md` + `{appId}.analysis.json`, run a **separate fresh-context** judge (`claude -p`, `--model claude-sonnet-4-6` — single constant `VERIFIER_MODEL`, flippable to Haiku). Fresh context = no confirmation bias (the writer can't grade itself — Anthropic).
- **Judge evidence (what the agent already produced):** the report, `analysis.json`, the original complaint, and the log digest — passed INLINE in the judge prompt. The judge grades the report against its OWN cited evidence (do the citations in the report support the root cause? is the fix grounded in the code the report references? is the verdict calibrated?). Single-shot, no extra tools — it scores the provided text. (A code-grounded judge that independently re-greps `/tmp/app` is a deliberate non-goal for v1 — keep it simple.)
- **Rubric → strict JSON** `{ pass: bool, score: 0-1, criteria: { rootCauseSupported, citationsResolve, fixGrounded, verdictCalibrated }, gaps: string[] }`. Single judge (Anthropic: one 0–1 + pass/fail judge most consistent).
- **Fail-closed action (no re-drill — no session-store yet):** on `pass=false`, patch `analysis.json` → `verdictConfidence='low'` + `verifierNote=<gaps summary>` before the S3 upload. Soft-fail: if the judge call errors/times out, leave analysis unchanged (never block the run).
- Thread `verifierNote` through `readAnalysis`/`AnalysisOverlay` → `InvestigationSummary`/`StatusResponse` → panel (render under the verdict badge).

- [ ] Steps: TDD `verifier.mjs` (mock the spawn → assert prompt carries report+analysis+complaint+digest, parse strict JSON, soft-fail on bad output); handler wiring (run post-synth, patch analysis on fail, clean up); thread `verifierNote`; `npm test` + `pnpm --filter debug-console test` green.

### Task V2 — Targeted parallelism + extended thinking

**Files:** modify the skill phase docs (`phase-0`/`phase-1`), `prompt.mjs`; `handler.mjs`/`auth.mjs` for the thinking flag.

- **Parallel tool calls (prompt-only, safe — all drill tools are read-only):** instruct the drill phase to issue independent reads/queries (logs + graph + convo + file reads) in ONE turn so the CLI runs them concurrently.
- **Extended thinking (env-flagged OFF by default — GoCode-proxy risk):** the proxy already rejected the `context_management` beta (`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`), so thinking may 400 every run. Wire it behind `INVESTIGATOR_ENABLE_THINKING` (default off); verify GoCode compat (one `claude -p` with thinking against GoCode test) before flipping on. When on, enable for the synthesize + verdict step (hardest reasoning).
