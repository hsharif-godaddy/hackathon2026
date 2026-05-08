# Phase 1: Analyze Evidence Indexes

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
- agent/tool failures
- preview or publish container 4xx/5xx responses
- control-plane publish/deploy failures
- repeated or rare failure signatures
- buckets with sudden spikes in log count or error count

Unknown/new failures are expected. Do not rely only on known keywords: inspect top signatures, rare error signatures, and any bucket with nonzero errors.

For raw drilldown, use targeted commands, for example:

```bash
jq '.logs[0:10]' /tmp/airo-log-investigate/{appId}/airo-preview/loki-p0000.json
```

Never paste full raw files into the conversation. Extract only the few records needed for citations.
