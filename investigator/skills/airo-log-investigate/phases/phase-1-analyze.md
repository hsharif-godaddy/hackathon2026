# Phase 1: Analyze Evidence Indexes

**Default mental model:** the bug is in the customer's app by default. Start from the customer app code (`$APP_CODE_DIR`) and the agent conversation (`$CONVERSATIONS_PATH`). Escalate to the platform code-review-graph only when a stack trace, conversation turn, or log template points at platform internals (agents/preview/publish/dev-supervisor/control-plane).

**Before flagging anything as missing / broken / a defect, rule out by-design behavior.** Read `references/aab-behaviors.md` — it documents AAB conventions that look like bugs but are not (homepage-built-first / pages-on-demand, routes needing explicit registration, expected startup log noise, customer-facing plan limits). Two checks:

1. **Is it in the conventions file?** If a symptom matches an entry, apply that entry's "Real bug if" signal — only report it when that signal is present.
2. **Did the customer actually ask for it?** Cross-check `$CONVERSATIONS_PATH`. AAB builds incrementally: a "missing" page/feature the customer never requested is expected, not a defect. "App links to /schedule but the route isn't registered" is by-design unless the conversation shows the customer asked for a schedule page.

If a symptom isn't covered by an entry and isn't explained by the conversation, proceed normally — the file is a false-positive filter, not an allowlist of the only things that can break.

Use the index to answer three questions:

1. What user-visible symptoms appear across `airo-app`, `control_plane`, `airo-agents`, `airo-preview`, and `airo-publish` evidence?
2. When did they occur relative to the feedback window?
3. What exact raw log refs support each finding?

Look for:

- `error`, `warn`, `fatal`, `exception`, `TypeError`, `ReferenceError`
- `4xx` and `5xx` status codes
- route/load failures
- asset or chunk load failures
- blank-page-ish signatures
- agent/tool failures, model errors, and high-latency agent turns
- preview or publish container 4xx/5xx responses
- control-plane publish/deploy failures
- repeated or rare failure signatures
- buckets with sudden spikes in log count or error count

Unknown/new failures are expected. Do not rely only on known keywords: inspect top signatures, rare error signatures, and any bucket with nonzero errors.

Correlate the agent conversation (`$CONVERSATIONS_PATH`) — what the customer asked and what the agent attempted — against the customer app code and the log evidence: a symptom in the logs usually traces back to a specific turn and the code the agent wrote for it. For "who calls this" / "what breaks if this changes", use the code-review-graph MCP (callers, callees, impact radius, tests) rather than scanning files by hand.

**Drill in parallel.** Your drill tools are all read-only and independent — issue them in a SINGLE turn so they run concurrently: customer app-code `Read`/`Grep`/`Glob` over `$APP_CODE_DIR`, customer + platform `code-review-graph` MCP queries, `fetch_log_lines` for the signatures you're chasing, and the conversation transcript. Don't serialize one-at-a-time when they don't depend on each other.

For raw drilldown, use targeted commands, for example:

```bash
jq '.logs[0:10]' /tmp/airo-log-investigate/{appId}/airo-preview/loki-p0000.json
```

Never paste full raw files into the conversation. Extract only the few records needed for citations.
