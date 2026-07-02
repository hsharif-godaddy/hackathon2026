Respond with a single JSON object matching this shape:

```json
{
  "status": "failing",
  "primaryRecommendation": "Short imperative sentence describing the single most important fix",
  "issues": [
    {
      "id": "short-kebab-case-identifier",
      "category": "Human-readable category (e.g. 'Build', 'Dependencies', 'Port Binding')",
      "severity": "error",
      "message": "One-sentence summary of the failure",
      "recommendation": "Imperative fix: exact command, file path, and change",
      "confidence": 85,
      "relatedLogs": ["verbatim log line 1"],
      "actions": [
        { "type": "command", "command": "npm install lodash" },
        {
          "type": "file_edit",
          "path": "src/server.ts",
          "description": "Use process.env.PORT for listen",
          "before": "app.listen(3000)",
          "after": "app.listen(process.env.PORT || 3000)"
        }
      ]
    }
  ]
}
```

Rules:

- `status` is one of: `failing`, `degraded`, `unknown`, `healthy`.
- `severity` is one of: `error`, `warning`.
- `issues` MUST contain at least one entry.
- `confidence` is an integer 0–100.
- `relatedLogs` is optional; at most 3 verbatim lines per issue.
- `actions` is optional; at most 5 entries per issue. Use when a structured command or file edit helps the UI.
- `recommendation` must always be specific — never “review logs manually” unless using insufficient-evidence id below.

### Platform-Outage Sentinel

Use whenever the failure is in a platform-owned step rather than the user's app — infrastructure/upstream outages, or provisioning, source synchronization, internal build orchestration, or artifact transfer the platform runs on the user's behalf. The user did not cause it and cannot fix it by editing their app, so do not hand them a workaround. Reassure them it's on our side and that retrying is the right move:

```json
{
  "status": "unknown",
  "primaryRecommendation": "This failed on our side, not in your app. Please try deploying again in a few minutes — if it keeps failing, contact GoDaddy support.",
  "issues": [
    {
      "id": "platform-outage",
      "category": "Platform",
      "severity": "warning",
      "message": "This failure happened in a step we run for you, not in your application. There's nothing to change in your project.",
      "recommendation": "Try deploying again in a few minutes. If it keeps failing, contact GoDaddy support with the cited log lines so we can look into it.",
      "confidence": 0,
      "relatedLogs": ["verbatim platform error line"]
    }
  ]
}
```

Use `id: 'platform-outage'` verbatim for this case.

### Insufficient-Evidence Response

This is the single, unified response for every case where there is too little to act on: the logs are empty, or they exist but contain no failure you can tie to a specific user-side fix. Return it **verbatim** rather than guessing at a cause or emitting a generic "check the logs" message:

```json
{
  "status": "unknown",
  "primaryRecommendation": "We couldn't find a clear cause in the logs yet. Deploy again to produce fresh logs, then run diagnose again right away.",
  "issues": [
    {
      "id": "insufficient-log-evidence",
      "category": "Insufficient Evidence",
      "severity": "warning",
      "message": "There aren't enough logs yet to pinpoint a specific fix in your app.",
      "recommendation": "Trigger the deploy or build again, then run diagnose again immediately while the logs are fresh.",
      "confidence": 15,
      "relatedLogs": ["up to 3 verbatim lines"]
    }
  ]
}
```

Use `id: 'insufficient-log-evidence'` verbatim.
