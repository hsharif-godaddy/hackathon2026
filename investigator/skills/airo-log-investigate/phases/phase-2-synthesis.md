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
    "category": "publish-failure"
  }
  ```

  Rules for each field:
  - `sentiment`: classify the *customer feedback input* (not the investigation findings) as `"positive"`, `"neutral"`, or `"negative"`.
  - `confidence`: your confidence in the sentiment classification as a float 0–1.
  - `rootCause`: copy the TL;DR sentence verbatim from the report (the single sentence under `## TL;DR`).
  - `category`: a short kebab-case tag describing the primary failure mode, e.g. `"publish-failure"`, `"websocket-error"`, `"build-failure"`, `"auth-failure"`, `"no-clear-failure"`. Use `"no-clear-failure"` when no failure is apparent.
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
```

## Required elements

Every report must include:

1. **TL;DR sentence** — believed cause + best next check. This is what the on-call dev reads first.
2. **Sources table** — coverage check.
3. **At least one finding** — even a "no clear failure observed" report should explain what was checked and why nothing was concerning.
4. **`git log` action item** — recent changes are the highest-yield diagnostic per Google SRE; always include "Check `git log` for changes to {suspect path/component} in the incident window" as one of the action items unless the finding is definitively config/data not code.

## Severity

Do not assign a severity label. The reader (on-call dev) judges severity from impact + scope using their own context. The Scope line gives them the inputs.

## Don'ts

- Don't exceed the length budget. Cut detail before findings.
- Don't call findings "bugs".
- Don't include raw JSON file paths or pointers inline. Source name in parentheses is the only citation in the body.
- Don't interleave timestamps across findings — each block stands alone.
- Don't include FullStory pre-builder navigation noise (different products, unrelated pages) unless directly relevant. If you mention it, put it under a one-line "Ruled out" bullet so coverage is defensible.
- Don't append cost, model name, token counts, or runtime metadata. The console UI renders those separately.
- Don't print the report in chat. File only.
