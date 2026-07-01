/**
 * App context brief — the L1 prompt-cached context for the Watchtower LLM reasoner.
 * Encodes what the app is, what "bad" means, and the severity rubric.
 * Update this file (not code) when priorities or architecture change.
 */
export const APP_CONTEXT = `
# Airo App Builder (AAB) — Watchtower context brief

## What this app is
app/ is the Airo App Builder website: a Next.js BFF + builder UI hosted on GoDaddy infrastructure.
Users come to create an AI-powered website, watch a live preview, chat with the AI to develop it, and publish it to a live domain.

## Golden flow (must work perfectly at all times)
  create app → preview loads → chat with AI → publish to live site

Every step must work for every user. Any degradation is significant.

## Severity rubric

**P1 — Page immediately (Slack @here)**
- publish flow degraded: publish_success_rate drops OR publish_failure spikes
- create flow degraded: create_success_rate drops OR create_failure spikes
- preview broken: preview_timeouts spikes significantly
- app appears down: log_count or req_throughput collapses vs baseline
- novel error type never seen before: new_error_fingerprints >= 1
- ALB serving 5xx at elevated rate: alb_5xx_count spikes

**P2 — Call out in digest, monitor**
- Any error_rate spike — auth errors, API errors, ALL errors matter
- Chat latency degraded: sse_first_response_p95_ms or latency_p95_ms spikes
- ALB latency spike: alb_p95_ms elevated
- APM request error rate up: req_error_rate spikes
- warn_count or distinct_error_events elevated

**P3 — Note in digest**
- Mild upward trends not yet breaching P2

## Noise suppression
None for now — alert on everything. The team will tune suppressions after seeing real alerts.

## Stat reference (all numeric, hourly rollup)
- log_count: total log events (lower = less traffic or app down)
- error_rate: error_count / log_count
- error_event_count: events with .error/.failed/.failure suffix
- distinct_error_events: unique failure event type names
- new_error_fingerprints: error event names never seen in prior 7 days (>= 1 = likely fresh bug)
- publish_success_rate: publish_success / (publish_success + publish_failure)
- create_success_rate: create_success / (create_success + create_failure)
- preview_timeouts: iframe timeout events on preview pane
- req_throughput: total APM requests (lower = traffic collapse)
- req_error_rate: APM-level HTTP error rate
- latency_p95_ms: APM request p95 latency in ms
- sse_connect_p95_ms: SSE connection p95 latency in ms
- sse_first_response_p95_ms: AI first-token p95 latency in ms (user-perceived AI speed)
- alb_5xx_count: ALB 5xx error count
- alb_p95_ms: ALB target response time p95 in ms
`.trim();
