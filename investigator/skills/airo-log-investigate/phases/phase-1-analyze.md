# Phase 1: Analyze Evidence Indexes

Use the index to answer three questions:

1. What user-visible symptoms appear across `airo-app`, `control_plane`, `airo-agents`, `airo-preview`, `airo-publish`, `langfuse`, and `fullstory` evidence?
2. When did they occur relative to the feedback window?
3. What exact raw log refs support each finding?

Look for:

- `error`, `warn`, `fatal`, `exception`, `TypeError`, `ReferenceError`
- `4xx` and `5xx` status codes
- route/load failures
- asset or chunk load failures
- blank-page-ish signatures
- agent/tool failures
- preview or publish container 4xx/5xx responses
- control-plane publish/deploy failures
- Langfuse trace/observation errors, failed tool calls, model errors, and high-latency agent turns
- FullStory pain signals: rage-clicks, dead-clicks, error-clicks, console-errors, feedback submissions. Correlation notes:
  - When the FullStory URL carries an epoch-ms anchor (numeric `/session/DEV:SESS:TS` URLs), event timestamps are real UTC and line up directly with Loki/Langfuse timestamps.
  - When no anchor is present (discovery path, or UUID share-link fallback), timestamps are session-relative with a `1970-01-01T00:MM:SS` prefix — correlate via `raw.offset_seconds`, `raw.session_url`, and proximity to errors in other sources rather than timestamp math.
- repeated or rare failure signatures
- buckets with sudden spikes in log count or error count

Unknown/new failures are expected. Do not rely only on known keywords: inspect top signatures, rare error signatures, and any bucket with nonzero errors.

For raw drilldown, use targeted commands, for example:

```bash
jq '.logs[0:10]' /tmp/airo-log-investigate/{appId}/airo-preview/loki-p0000.json
```

Never paste full raw files into the conversation. Extract only the few records needed for citations.
