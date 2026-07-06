# Known local-dev noise catalog

Recurring WARN/ERROR lines that are **expected** when running Airo Builder
locally, why each is benign, and the small set that genuinely means something.
Read this before classifying an event as a problem. Patterns are grep-ready for
the Step 5 `-vE` exclusion list.

## Benign — suppress once confirmed recurring

| Pattern | Where | Why it's expected locally |
| --- | --- | --- |
| `event_bus_client` / `Failed to send batch to event bus` | agents (Rust ECS JSON) | The switchboard/event-bus telemetry client can't reach its external endpoint (`https://csp.…`) from a laptop, so it errors and re-queues every few seconds. Pure telemetry; no app impact. |
| `POST /api/apps/<id>/events 502` + `mgmt-airo.record-event.error` + `events.api.upstream-failed` | app | The app-side counterpart of the same event bus — posting lifecycle/analytics events to the mgmt-airo `record-event` upstream, unreachable locally, so it 502s after a ~10s timeout. Same root cause as above. |
| `subscription.api.get-by-id.forbidden` | app | Ownership guard rejecting a subscription that isn't the current customer's, fired during routine subscription polling. Expected guard behavior, fires often. |
| `model.provider.fallback` | agents | Model provider falling back to an alternate at startup / per request. Informational. |
| `care.bridge.disabled` | agents | The care bridge integration is off in local dev. |
| `aab-multi-user.fga.skip-not-configured` | app | Fine-grained authz (FGA) isn't configured locally, so the check is skipped. |
| `path-helper.absolute-to-relative` | agents | A path helper normalizing an absolute path to relative. Informational. |
| `share.buildShareUrl.noCellPrefix`, `share.previewUrl.*.failure`, `route.middleware.ownership.invalid-id-shape` | agents/app | Share-URL minting and id-shape guards that don't have their production inputs locally. |
| `customer_id_change_rejected` | agents | Registration reconciling a customer id at startup. |
| `conversation.history.loader.no_segments` | agents | A fresh conversation with no prior history segments — normal on first message. |

## Watch only if it repeats or loops

| Pattern | Meaning | When it becomes real |
| --- | --- | --- |
| `preview-pane.iframe.bootstrap-timeout … remounting` | The preview iframe didn't signal ready in time and auto-remounted. | Self-heals once. A repeating remount loop means the preview is genuinely stuck — investigate the preview container / the app it's loading. |
| `ai-lib.duplicate-detection … duplicate_response.detected` | The agent re-issued an identical tool call (e.g. retried a screenshot). | Fine as a single retry. Sustained duplicates (hitting the threshold repeatedly) mean the agent is stalled in a loop. |
| `stream.tool.slow_execution` (carries `toolName` + `toolDurationMs`) | A tool exceeded the slow-execution threshold. Fires for whatever tool ran long — a long build/workflow tool is the common benign case (`toolDurationMs` in the 100k–400k ms range). | Normal for a build — those take minutes. Notable only when `toolName` is one that should be fast. |

## Real — surface immediately

These are rarely benign; report them with surrounding context.

- **Compile / bundling failures:** `⨯`, `Failed to compile`, `Module not found`,
  `Cannot find module`, `MODULE_NOT_FOUND`. The app or a build is broken.
- **Process death:** `panic:` (Go/Rust), `exited with`, `crashed`, unhandled
  promise rejections. A service went down — subsequent errors may cascade from it.
- **Connection / port failures:** `ECONNREFUSED`, `EADDRINUSE`, `EADDRNOTAVAIL`.
  A dependency service isn't up, or two processes want the same port. Often the
  root cause of a wave of downstream errors.
- **5xx on a real route:** ` 500 in `, `- 500 (`, etc. on an app/agents route
  that isn't the known-benign `/events` telemetry endpoint above.
- **Tool-execution failures:** `ai-lib.agent-factory.tool.execution.failure`,
  `sse.client-action.error`, `… timed out after …s` (e.g. `Screenshot capture
  timed out`). A feature the agent invoked failed — often worth a Step 6
  `local-export-chat.ts` deep-dive on the affected `appId`.

## How to tell benign from real when unsure

1. Is it in the benign table above? Suppress it.
2. Does it name an external endpoint the laptop can't reach (`csp.…`, mgmt-airo
   record-event)? Almost always benign telemetry.
3. Did a `200` on the same request follow, or did the workflow still report
   `status:"success"`? Then the error was tolerated/degraded gracefully — note it,
   don't alarm.
4. Is it a compile failure, a `panic`/exit, a connection refusal, or a 5xx on a
   real route? Real — surface it with context.
5. Still unsure and it's app-scoped? Run the Step 6 export for that `appId`.
