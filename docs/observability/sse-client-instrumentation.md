# SSE Client-Side Instrumentation (AIROBUILD-2557)

Client-perceived connection/latency signal for the SSE chat transport, mirroring
the WebSocket `NetworkQualityMonitor` path. Emitted by `SSEQualityMonitor`
(`app/src/services/transport/SSEQualityMonitor.ts`), owned by `useSSEChat` and
injected into `SSETransport`.

## Channels

- `shipAnalyticsLog('funnel.sse.*', data)` — ships at `info` ALWAYS via
  `ClientLogBuffer`, once per connect and once per send. Server forwards as
  `client.funnel.sse.*`. Use for "every connect/send", not just slow ones.
- `logger.warn('sse.transport.quality.*', data)` — ships only on threshold
  breach (warn+ gate). Use for high-signal alerts.

Analytics events are emitted sparingly (never on every `EventSource.onerror`),
to stay under the buffer cap (50/flush, 200 overflow).

## Events and fields

### `funnel.sse.connected` (once per initial connect)
| Field | Meaning |
| --- | --- |
| `configFetchMs` | `getConfigForSite` duration (overlaps `tokenFetchMs`) |
| `tokenFetchMs` | `getAgentToken` duration (overlaps `configFetchMs`) |
| `conversationCreateMs` | conversation-create POST retry-loop duration. Present only when `conversationSource = created` |
| `conversationSource` | `cookie` \| `created` |
| `streamOpenMs` | `openEventSource` → first SSE event of any type |
| `totalMs` | connect-start → first stream event (wall-clock; NOT a sum of phases) |
| `tokenResourceTiming` | best-effort Performance API timing for the token fetch (same-origin) |
| `streamResourceTiming` | best-effort Performance API timing for the `/stream` GET (cross-origin; requires `Timing-Allow-Origin`, else absent) |

### `funnel.sse.first_response` (once per send)
| Field | Meaning |
| --- | --- |
| `firstResponseMs` | `markSend` (POST initiation) → first of `chunk`/`tool_start`/`tool_input_delta`/`tool_call`, measured in the hook AFTER replay-dedup and stale-`stream_retry` guards |

### `sse.transport.quality.slow_connect` (warn; `totalMs > 10s`)
Includes `totalMs`, `streamOpenMs`, phase fields, `threshold`.

### `sse.transport.quality.slow_first_response` (warn; `firstResponseMs > 5s`)
Includes `firstResponseMs`, `threshold`.

### `sse.transport.quality.excessive_errors` (warn; at consecutive-error buckets 3/6/9)
`consecutiveErrors` counts `EventSource.onerror` callbacks (not true retries);
resets on a successful `initialize`. Includes `threshold`.

Thresholds reuse the WS constants: connect 10s, first-response 5s, error-bucket 3.

## Querying in ESSP / Kibana

Client logs ship to the airobuilde ESSP Elastic cluster (NOT Loki). Use
`./scripts/essp-creds.sh dev|prod`; index pattern
`.ds-logs-gdelastic.katana.<app-name>-<environment>-*`.

- Filter event: `event: "client.funnel.sse.connected"` (or `*.first_response`,
  `client.sse.transport.quality.*`).
- Correlate a session: `data.appId` and `data.log_session_id`.

### appId queryability caveat
`shipAnalyticsLog` → `mergeAnalyticsContext` DROPS UUID-shaped appIds
(`normalizedAppId`), and job-type sessions clear the instrumentation appId until
it resolves to a site id. The monitor passes `currentAppId` explicitly, but
job-id sessions key differently until resolved. Expect some connects to land
with no `appId` — correlate those by `log_session_id`.

## Out of scope / impossible (documented so the gap is understood)

- **Symmetric ping/pong RTT.** SSE is unidirectional (server→client) with no
  client→server channel on the stream. There is no equivalent to the Socket.IO
  ping/pong without a dedicated server echo endpoint (explicitly out of scope).
  `firstResponseMs` is the closest analogue: HTTP request/response + server
  processing, not a symmetric socket ping.
- **WebSocket-handshake breakdown** (TLS/WS handshake phases) does not apply to
  an HTTP GET stream.
- **Wiring ESSP into Grafana** (the transport-rollout dashboard) is a separate
  infra task.
