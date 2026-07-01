# llm-bench

Replay a **real, captured** LLM workload against a target endpoint and report
load/latency metrics — built to find the concurrency level at which candidate
GPU hardware starts to degrade, using traffic recorded from the actual agent
instead of a synthetic prompt.

It reads mitmproxy flow dumps (the same chat traffic the agent already
produces), re-points each request at a target endpoint, replays the sessions at
configurable concurrency (fixed, timed, or ramping), and prints a
per-concurrency breakdown of time-to-first-token, per-request and aggregate
tokens/sec, request rate, and error rate — plus a comparison against the
metrics recorded in the dump.

**Two wire formats** are supported and detected per request from the captured
path, so a dump (or mix of dumps) replays without configuration:

- **OpenAI-compatible** Chat Completions — `POST .../chat/completions`.
- **Anthropic Messages** — `POST /v1/messages` (e.g. Claude via the GoCode proxy
  or Bedrock). Usage is read from the native `message_start` / `message_delta`
  frames; `stream_options` is omitted (Anthropic rejects it); the
  `--unique-sessions` cache-buster lands in the first message and
  `--bust-system-prompt` rewrites the top-level `system` field.

Written in Rust (tokio) so a single laptop can drive high concurrency with a
flat memory profile.

## 1. Capture a workload

Record real traffic with mitmproxy while building an app through the agent. The
repo already has a reverse-proxy helper:

```sh
# Terminal 1: proxy the LLM backend and write flows to a file
mitmdump -w workload.flow --mode reverse:http://<llm-backend-host>:8000

# Point the agent at the proxy (see scripts/mitmproxy/README.md), then drive the
# app normally. Every chat-completion round-trip is appended to workload.flow.
```

Each dump file is treated as **one session**: its requests are replayed in
capture order by a single virtual user, preserving the growing-context /
prompt-cache shape of a real conversation.

## 2. Inspect what was captured

```sh
cargo run --release -- --dump-only workload.flow
```

Prints each request (model, body size) and its recorded baseline (status,
latency, prompt/completion/cached tokens, tokens/sec).

## 2b. Probe the target (`--probe`)

Before committing to a long run, replay a session against the target and watch
exactly what comes back:

```sh
llm-bench --probe --target http://<gpu-host>:8000 workload.flow
```

Probe replays the **whole first session in capture order**, back-to-back, exactly
as one virtual user would in a real run — it rewrites each request the same way
the load path does (model override, cache-buster, auth; it honors `--model`,
`--api-key`, `--forward-auth`, `--unique-sessions`, and `--request-timeout`). For
each request it prints a one-line header (outgoing body size, message count) and
**streams the response live**:

- visible `content` in plain text,
- reasoning-model thinking dimmed (so you can see whether thinking is on/off),
- **tool calls** as `→ name {streamed arguments…}` — essential for agent traffic,
  where a response is often entirely a tool call with no visible content,

followed by a per-request metrics line (status, prompt/completion tokens, first-
and last-token times, decode tok/s, and any tool names), then a session summary
(requests, ok/errors, total completion tokens, wall time).

Use it to confirm end-to-end that the endpoint returns sensible content, the
reasoning toggle behaves as configured, and tool calls come back intact — before
you fan out. Note it replays the captured request bodies **verbatim**, so it
reflects whatever parameters were in the dump when captured; to exercise new
client-side config, capture fresh traffic first.

## 3. Replay against a target

```sh
# Build once
cargo build --release

# Ramp concurrency 1→32 in steps of 4, 60s per step, find the knee
./target/release/llm-bench \
  --ramp --ramp-start 1 --ramp-end 32 --ramp-step 4 --ramp-step-duration 60 \
  --target http://<gpu-host>:8000 \
  --output-json run.json \
  workload.flow
```

### Authentication

Captured credential headers — `Authorization` and Anthropic's `x-api-key` — are
**not** sent by default (they may be stale, and you are often re-pointing at a
different host). Choose one:

```sh
# Replay the token captured in the dump (same endpoint, token not yet expired)
llm-bench --ramp ... --forward-auth workload.flow

# Authenticate with a fresh token (overrides any captured one)
LLMBENCH_API_KEY=<token> llm-bench --ramp ... --target URL workload.flow
```

If requests come back `401/403` and the dump carried a credential, the tool
prints a hint pointing at these options.

Other modes:

```sh
# Fixed number of requests at a fixed concurrency
llm-bench --fixed --concurrency 8 --max-requests 200 --target URL workload.flow

# Run at a fixed concurrency for a set duration
llm-bench --duration 120 --concurrency 8 --target URL workload.flow
```

### Reading the report

Columns: `Concurrency | Reqs | Err% | TTFT p50 (ms) | TTFT p99 (ms) | TTLT p50
(ms) | TTLT p99 (ms) | decode tok/s/req p50 | Aggregate tok/s | Req/s | e2e
tok/s vs baseline`.

The hardware **knee** is where `Aggregate tok/s` stops climbing as
`Concurrency` increases while `TTFT` rises — beyond that point you are adding
load without adding throughput.

**Two different throughput numbers** (don't conflate them):

- **decode tok/s/req** = `completion_tokens / (total − first_token_time)` — pure
  generation speed once decode starts, with the prompt prefill excluded. The
  denominator starts at the **first generated token of any kind** (reasoning
  *or* visible content), not at TTFT: server `completion_tokens` counts include
  reasoning tokens, so for a reasoning model the reasoning phase must stay inside
  the decode window or this rate is overstated.
- **e2e tok/s vs baseline** = `completion_tokens / total` (prefill included),
  compared against the same end-to-end figure recorded in the dump. This is the
  only apples-to-apples baseline comparison, because flow files only record
  whole-response timing (no recorded TTFT).

With large prompts (tens of thousands of tokens), decode tok/s is much higher
than e2e tok/s — most of each request's wall-clock is prefill.

### Prompt caching and realistic load (`--unique-sessions`)

Replaying one dump file at concurrency N sends N **identical** prompts, which
servers with prefix caching (vLLM/SGLang/etc.) serve largely from a shared KV
cache — artificially cheap prefill that understates GPU load. Real concurrent
users have *different* contexts.

`--unique-sessions` injects a per-replay-instance marker into the prompt,
**after the leading system prompt** (the first non-system message):

- The marker is **constant within one session replay**, so caching *within* a
  conversation (the realistic `cached_tokens` growth across a user's own turns)
  is preserved.
- The marker is **unique across concurrent replays**, so the server cannot share
  the per-user *conversation* prefix between virtual users — each pays full
  prefill on its own context, as a distinct real user would.
- The **shared system prompt stays byte-identical** across all virtual users, so
  the server caches it exactly as a production fleet would (every app sends the
  same system prompt). This is the faithful model of real load.

If you instead want the conservative worst case — no shared caching at all, not
even the system prompt — add `--bust-system-prompt`, which moves the marker
ahead of the system prompt. For the most faithful mix overall, capture several
*different* sessions and pass them all.

### Sizing the run

Per-step numbers are only trustworthy when each step completes many requests
that **start and finish within the step**. If a single request's latency
approaches or exceeds `--ramp-step-duration`, requests span step boundaries,
sample counts shrink, and aggregate tok/s is distorted (it credits a step with
tokens that were actually generated later). Watch the `Reqs` and `TTFT p99`
columns: if `Reqs` is in the single/low-double digits or `TTFT p99` is on the
order of the step duration, lengthen `--ramp-step-duration` (minutes, not
seconds) and/or raise `--ramp-warmup`. A saturating server with two-minute
queue waits needs steps far longer than 60s to produce stable numbers.

## Key options

| Option | Purpose |
| --- | --- |
| `--target <URL>` | Endpoint under test, e.g. `http://localhost:8000` |
| `--model <NAME>` | Override the `model` field in every request |
| `--api-key <KEY>` | Sent as `Authorization: Bearer <key>` on every request, either wire (or `LLMBENCH_API_KEY` env); overrides any forwarded credential |
| `--forward-auth` | Forward the captured credential header as-is — `Authorization` for OpenAI, or Anthropic's `x-api-key` / `api-key`. Ignored when `--api-key` is set |
| `--fixed` / `--duration <S>` / `--ramp` | Load mode (mutually exclusive) |
| `--concurrency <C>` | Concurrent virtual users (fixed/duration) |
| `--ramp-start/-end/-step/-step-duration/-warmup` | Ramp shape + per-step warmup |
| `--repeat <N>` | Times to cycle through the sessions |
| `--unique-sessions` | Make each concurrent replay unique (defeat cross-user prefix caching), keeping the system prompt cacheable |
| `--bust-system-prompt` | With `--unique-sessions`, also defeat the shared system-prompt cache (worst case) |
| `--preserve-think-time` / `--max-think-time <S>` | Replay recorded inter-request gaps |
| `--max-duration <S>` / `--max-requests <N>` | Global stop caps |
| `--request-timeout <S>` | Per-request timeout (records a `timeout` outcome) |
| `--drain-timeout <S>` | Max wait for in-flight requests after the run ends before aborting them (default: wait indefinitely) |
| `--output-json <F>` / `--output-csv <F>` | Machine-readable outputs |
| `--no-progress` / `--quiet` | Quieter output (for CI) |
| `--dump-only` | Parse the dumps, print a summary, and exit without replaying |
| `--probe` | Replay a whole session live, streaming each response (content, reasoning, tool calls) + metrics (see §2b) |

Press **Ctrl-C** at any time to stop and still get a report of what completed.

When a run ends (or is interrupted), workers finish the request they are
mid-stream on before stopping — cancellation is checked between requests, never
mid-response. On a saturated target this **drain** can take a while; the
progress line switches to `draining N in-flight request(s)…` so the wait is
visible. Use `--drain-timeout <SECS>` to cap it: stragglers still running past
the cap are aborted and excluded from the report.

## How metrics are defined

- **TTFT** — send → first SSE chunk carrying a generated token of **any** kind:
  visible content, reasoning, or a tool-call fragment. This is the moment the
  stream starts returning data (the end of prefill). Tool-call- and
  reasoning-only responses — the norm for agent traffic — count, so their turns
  aren't silently dropped from the TTFT aggregate.
- **TTLT** (time-to-last-token) — send → *last* SSE chunk carrying a generated
  token of any kind. It is slightly less than `total` latency, which also counts
  the trailing `usage` and `[DONE]` frames.
- **Per-request tok/s** — `completion_tokens / (total − TTFT)`: decode
  throughput with prefill excluded (TTFT marks the decode start, so numerator
  and denominator stay consistent). Uses the server's final usage counts
  (OpenAI: forced `stream_options.include_usage`; Anthropic: the native
  `message_start` / `message_delta` usage frames); falls back to estimating from
  streamed generated-text bytes if usage is absent.
- **Aggregate tok/s** — sum of completion tokens started in a step's
  post-warmup window ÷ that window's wall-clock seconds. This is the
  saturation signal.
- Each request is attributed to the step its **send time** fell in, so a slow
  request from a lighter step never inflates a heavier step's percentiles.

## Development

```sh
cargo test                                   # unit + mock-server integration tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo run --example mock_server -- 127.0.0.1:8000   # local OpenAI-compatible mock
```

The mock streams a fixed token count with per-token delay — useful for
exercising the tool end-to-end without real hardware.
