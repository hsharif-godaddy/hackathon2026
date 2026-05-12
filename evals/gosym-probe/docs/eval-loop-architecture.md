---
type: knowledge
title: "gosym-probe: Eval Loop Architecture"
status: active
tags: [gosym-probe, eval, llm-judge, aab, testing]
---

# gosym-probe: Eval Loop Architecture

gosym-probe is a local agent evaluation harness that runs scripted scenarios
against a live Airo App Builder (AAB) instance. It uses two LLMs: one to
simulate the user, and one as an LLM judge to score results.

## System Layers

```
CLI (src/index.ts)
  └─ SuiteRunner          — iterates scenarios × k trials
       └─ Simulation      — single conversation loop
            ├─ GocodeSyntheticUser  — LLM-powered simulated user
            ├─ AABClient            — Socket.IO to the real AAB agent
            └─ DOMCapture           — Playwright screenshot/HTML
```

---

## Conversation Phase

### 1. Setup

Each scenario optionally runs a setup function (e.g., provisioning a fresh
AAB app via the Agents API) before the conversation starts.

### 2. Simulated User Turn

`GocodeSyntheticUser` makes a single LLM call to GoCode (Claude Sonnet) per
turn. It receives:

- Scenario goals framed as `ACHIEVE`/`AVOID` statements (system prompt)
- Full conversation history so far (user prompt)

The model replies with the next user message, or the literal string `DONE` to
terminate the conversation early. No streaming — the full response is buffered.

### 3. Generator Agent Turn

The user message is sent to the live AAB agent via Socket.IO. AAB runs its
own internal LLM call(s). During this, gosym-probe observes streaming events:

| Event | What it means | Recorded? |
|---|---|---|
| `tool_start` | Generator begins a tool/subagent call | Yes — opens a `ToolCall` record with `id`, `name`, `input`, `startTime` |
| `tool_result` | Tool/subagent call completes | Yes — fills `output`, `error`, `endTime` |
| `chunk` | Streaming text fragment | No |
| `tool_call` / `tool_input_delta` | Intermediate tool events | No |
| `complete` | Full assistant response ready | Signals turn end |
| `error` | Socket-level error | Yes — added to `transcript.errors[]` |

Subagent calls look identical to tool calls from the harness's perspective —
they emit the same `tool_start`/`tool_result` events and are recorded the
same way.

All tool calls for a turn are timestamped and attached to the turn record.
The turn resolver is swapped per-turn (not re-registered) to avoid listener
accumulation.

### 4. DOM Snapshot

After each assistant turn, Playwright optionally captures a screenshot and
the raw HTML of the AAB Next.js UI. The `<body>` content is extracted (up to
10,000 chars, truncated if larger) and stored as a `DOMSnapshot`. This is
what the `output-quality` judge evaluates.

### 5. Repeat

Steps 2-4 repeat until `DONE`, `maxTurns` is hit, or a timeout fires.
Teardown runs after the loop (e.g., deleting the ephemeral AAB app).

**Two LLM calls happen per turn:**
1. GoCode call — synthetic user produces the next message
2. AAB generator's internal LLM call(s) — observed via socket events

---

## Evaluation Phase

The resulting `Transcript` (all turns + tool calls) is passed to a set of
evaluators. Each returns
`{ score: 0.0–1.0, verdict: pass|partial|fail|unknown, reason: string }`.

### Computed Evaluators (no LLM)

| Evaluator | What it measures | Scoring |
|---|---|---|
| `bug-hit-rate` | Count of socket `error` events | `1 / (1 + errorCount)` — pass if ≤1 error |
| `prompt-efficiency` | User turns taken vs. `scenario.maxTurns` (default 30) | `max(0, 1 - turns/maxTurns)` — pass at ≥0.7 |
| `tool-call-verification` | Expected tools called (or not called) | Fraction of `scenario.expectedTools` assertions satisfied |

### LLM Judge Evaluators (GoCode, re-run every trial)

**`jtbd-completion`** — Jobs To Be Done completion judge.

Sends to GoCode:
- Full conversation transcript formatted as `[USER]: ... / [ASSISTANT]: ...`
- Scenario goals as numbered questions (`Did the agent accomplish: "..."`)
- Optional reference solution

Model is instructed to reply with exactly one word: `pass`, `partial`, `fail`,
or `unknown`. Score mapping: pass=1.0, partial=0.5, fail/unknown=0.0.

**`output-quality`** — DOM snapshot quality judge.

Sends to GoCode:
- Task description (all goal descriptions joined with `;`)
- Raw `<body>` HTML from the last Playwright snapshot (≤10,000 chars)
- Optional reference DOM if `scenario.referenceSolution` is a `DOMSnapshot`

Model responds in a structured format:
```
SCORE: [0.0-1.0]
VERDICT: [pass|partial|fail|unknown]
REASON: [brief explanation]
```

Scale: 1.0=excellent, 0.7–0.9=good, 0.4–0.6=partial, 0.1–0.3=poor,
0.0=failed.

Both judges use the same `GocodeClient` as the synthetic user — no separate
judge model is configured.

---

## Aggregation

`SuiteRunner` runs `k` trials per scenario:

- All evaluators run once per trial; TrialAggregator handles cross-trial aggregation.
- Judge evaluators run fresh on every trial
- `pass@k` — any trial passes
- `pass^k` — all trials pass

If a baseline JSON exists, `RegressionComparator` flags per-evaluator score
drops and sets `exceeded: true` on regressions.

Trials run sequentially by default (required for AAB due to shared Socket.IO
state). Parallel mode is available via `scenario.executionMode`.
