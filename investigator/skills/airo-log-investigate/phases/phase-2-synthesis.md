# Phase 2: Write the Report

Write a focused investigation report. Reader is on-call; they want to know what broke, why it likely broke, and what to do next.

The constraints below are not stylistic — they are based on what research says actually helps engineers debug fastest:

- Google SRE _Effective Troubleshooting_: state raw observations not conclusions; lead with recent changes; quantify scope.
- PagerDuty Incident Commander training: tasks must be time-boxed (who + what + when); short updates beat long briefings.
- Cognitive load research (Miller's 7±2): humans hold ~5–7 items in working memory; ranked hypotheses beat exhaustive lists.

Honour the caps below. They exist so the on-call dev can read the whole report in 60 seconds and so the report fits in a single Slack message without compression.

## Output rules (must follow)

- **Write the report to a file at `${REPORT_DIR}/{appId}.md`. Do not print the report contents in chat.**
- **Also write a machine-readable analysis to `${REPORT_DIR}/{appId}.analysis.json`.** This file is consumed by the debug-console dashboard to populate listing fields. Write it immediately after writing the markdown report. Contents:

  ```json
  {
    "v": 1,
    "sentiment": "negative",
    "confidence": 0.85,
    "rootCause": "<exact TL;DR sentence from the report>",
    "category": "publish-failure",
    "verdict": "agent-bug",
    "relatesTo": "publish-pipeline",
    "verdictConfidence": "high",
    "verdictRationale": "<1-3 sentences citing the concrete evidence (log template, conversation turn, or code location) that drove the call>",
    "fixKind": "app-prompt",
    "fixPrompt": "<a self-contained instruction to paste into the customer app's develop-agent chat, naming exact files/symbols and the concrete change; or null>",
    "engNote": null
  }
  ```

  Rules for each field:
  - `sentiment`: classify the *customer feedback input* (not the investigation findings) as `"positive"`, `"neutral"`, or `"negative"`.
  - `confidence`: your confidence in the sentiment classification as a float 0–1.
  - `rootCause`: copy the TL;DR sentence verbatim from the report (the single sentence under `## TL;DR`).
  - `category`: a short kebab-case tag describing the primary failure mode, e.g. `"publish-failure"`, `"websocket-error"`, `"build-failure"`, `"auth-failure"`, `"no-clear-failure"`. Use `"no-clear-failure"` when no failure is apparent.
  - `verdict`: one of
    - `"agent-bug"` — the develop-agent produced wrong code or mis-used a tool.
    - `"customer-error"` — a user mistake or expected behavior, not a defect.
    - `"platform-bug"` — an Airo platform defect (agents/preview/publish/dev-supervisor/control-plane).
    - `"external"` — a third-party, dependency, or infra issue outside our control.
    - `"no-issue"` — nothing wrong, or the issue could not be reproduced.
  - `relatesTo`: short kebab-case tag for the affected area, e.g. `"preview-build"`, `"auth-session"`, `"publish-pipeline"`, `"data-fetch"`.
  - `verdictConfidence`: `"low"` | `"medium"` | `"high"`.
  - `verdictRationale`: 1–3 sentences citing the concrete evidence (log template, conversation turn, or code location) that drove the call.
  - `fixKind`: one of
    - `"app-prompt"` — the fix lives in the customer's app code (pairs with `verdict` `agent-bug` or `customer-error`).
    - `"eng-note"` — the fix is a platform change (pairs with `verdict` `platform-bug`).
    - `"none"` — no actionable fix (pairs with `verdict` `external` or `no-issue`).
  - `fixPrompt`: set **only** when `fixKind === "app-prompt"`. A self-contained instruction addressed to the develop-agent, naming the exact files/symbols (from the code-review-graph / code reads) and the concrete change to make. `null` otherwise.
  - `engNote`: set **only** when `verdict === "platform-bug"`. Name which service, what is wrong, and the suggested area to look. `null` otherwise.
  - **Fail toward benign.** When signals are weak, prefer `"no-issue"` or `"customer-error"` over inventing a defect. Do not fabricate a `fixPrompt` you cannot ground in cited code or logs. If the symptom matches a by-design entry in `references/aab-behaviors.md` and that entry's "Real bug if" signal is absent, the verdict is `"customer-error"` or `"no-issue"` (not a defect) — and `verdictRationale` should name the convention. Conversely, only assign `"agent-bug"`/`"platform-bug"` for a "missing" feature if the conversation shows the customer actually requested it.
  - Do not add any other fields. Do not print this JSON in chat.
- **Do not narrate the work in chat.** No "I'll start by reading...", no "Good — sources complete", no "Let me drill into raw refs", no "All evidence collected. Writing the synthesis report." Such lines leak into the saved report through the trace fallback. Stay silent in chat once analysis starts; do the work, write the file, exit.
- One short status line per phase marker (`phase-N-name`) is fine for progress tracking. Anything else stays out of chat.

## Length budget (hard ceilings)

- **Total report: ≤ 20,000 characters.** Enough room for a thorough multi-finding investigation while keeping the report scannable in a few minutes.
- **Observation bullets per finding: ≤ 5.** Keep the most informative timestamps. Use `×N` for repetition rather than listing every occurrence.
- **Hypotheses per finding: ≤ 2 (most likely + best alternative).** Drop low-probability hypotheses; the on-call dev does not need them ranked exhaustively.
- **To-confirm bullets per finding: ≤ 2.** One concrete imperative per hypothesis is enough.
- **Action items total: ≤ 5.** Each must be doable in one sitting and time-boxed where possible (e.g. "(15 min)").

If the evidence is genuinely too rich for these caps, prefer fewer findings over verbose ones. A report covering 2 findings well beats one covering 4 findings shallowly.

## Voice

- State observations as facts. State interpretations as hypotheses, ranked.
- Use "finding", not "bug". Don't claim a root cause unless evidence proves it.
- Quote error strings exactly. Include relevant payload fields (e.g. `currentCount: 10`, `hasNewText: false`).
- Describe symptoms not causes ("HTTP 502 on /api/x" not "API is down").

## Citations

- The Sources table at the top of the report is the only place evidence is cited. It proves coverage at a glance.
- **Do NOT include raw-ref paths inline** (no `airo-app/b004-p0000.json#$.logs[2]`, no file paths, no JSON pointers in the body).
- Each observation bullet ends with the source name in parentheses — `(airo-app)`, `(airo-agents)`, etc. That is enough.

## Report structure

```markdown
**App:** `{appId}` · **Window:** {start} – {end} · **Feedback:** "{verbatim feedback or 'no feedback given'}"

## TL;DR

One sentence. Most user-impacting finding + believed cause + the single best next check.
Example: *"Publish blocked: customer hit the 10/month professional-plan cap on 2026-05-08; verify the count in the publish-count store before assuming a counting defect."*

## Sources

| Source | Logs | Window | Complete |
| --- | --- | --- | --- |
| `airo-app` | N | 7d | ✅ / ⚠ |
| ... | ... | ... | ... |

State any incomplete bucket in plain language under the table.

## Finding 1: <short headline naming the believed cause>

**Scope:** Single user / Multiple users / Outage — one phrase.

**Observation** (≤ 5 bullets)

- `09:00:29 UTC 2026-05-08` — `paywall.eligibility.publish-limit-reached` ×14 with `currentCount: 10`, `limit: 10`, `plan: "professional"` (airo-app)
- ... up to four more

**Hypotheses** (≤ 2)

1. Most likely — one sentence anchored in evidence.
2. Best alternative — one sentence.

**To confirm** (≤ 2)

- One imperative per hypothesis (grep, query, file read).
- Mark steps that need data outside this evidence bundle.

## Finding 2: ...

(same shape, same caps)

## Action items (≤ 5 total)

- [ ] Specific action with file path or grep target — time-boxed where possible
- [ ] Check `git log` for changes to {suspect path} in the incident window

## Verdict

One line: the verdict (`agent-bug` / `customer-error` / `platform-bug` / `external` / `no-issue`), the area it relates to, and confidence. One or two sentences of rationale citing the concrete evidence (log template, conversation turn, or code location).

## Suggested fix

When the fix lives in the customer's app, render the develop-agent prompt in a fenced block so a human can copy it verbatim:

```text
<self-contained instruction naming exact files/symbols and the concrete change>
```

For a platform-bug, give the eng note instead (which service, what's wrong, where to look). For `external`/`no-issue`, state that no fix is warranted and why.
```

## Required elements

Every report must include:

1. **TL;DR sentence** — believed cause + best next check. This is what the on-call dev reads first.
2. **Sources table** — coverage check.
3. **At least one finding** — even a "no clear failure observed" report should explain what was checked and why nothing was concerning.
4. **`git log` action item** — recent changes are the highest-yield diagnostic per Google SRE; always include "Check `git log` for changes to {suspect path/component} in the incident window" as one of the action items unless the finding is definitively config/data not code.
5. **Verdict + Suggested fix** — must match the `analysis.json` sidecar fields. The report's `## Verdict` line mirrors `verdict`/`relatesTo`/`verdictConfidence`/`verdictRationale`; the `## Suggested fix` block mirrors `fixKind`/`fixPrompt`/`engNote`.

## Severity

Do not assign a severity label. The reader (on-call dev) judges severity from impact + scope using their own context. The Scope line gives them the inputs.

## Don'ts

- Don't exceed the length budget. Cut detail before findings.
- Don't call findings "bugs".
- Don't include raw JSON file paths or pointers inline. Source name in parentheses is the only citation in the body.
- Don't interleave timestamps across findings — each block stands alone.
- Don't fabricate a verdict or `fixPrompt` you can't ground in cited code, logs, or the conversation. When signals are weak, fail toward `no-issue`/`customer-error`.
- Don't append cost, model name, token counts, or runtime metadata. The console UI renders those separately.
- Don't print the report in chat. File only.
