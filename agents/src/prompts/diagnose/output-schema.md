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

Use only when logs show platform/infrastructure failure with **no** customer code fix:

```json
{
  "status": "unknown",
  "primaryRecommendation": "The deployment platform is temporarily unavailable. Retry in a few minutes or contact support if the issue persists.",
  "issues": [
    {
      "id": "platform-outage",
      "category": "Platform",
      "severity": "warning",
      "message": "Logs indicate a platform or upstream infrastructure issue, not an application configuration problem.",
      "recommendation": "Wait a few minutes and retry deployment. If failures continue, contact GoDaddy support with the cited log lines.",
      "confidence": 0,
      "relatedLogs": ["verbatim infrastructure error line"]
    }
  ]
}
```

Use `id: 'platform-outage'` verbatim for this case.

### Insufficient-Evidence Response

When logs exist but are too sparse for any concrete fix:

```json
{
  "status": "unknown",
  "primaryRecommendation": "Re-trigger the failure to capture fresh logs, then run diagnose again.",
  "issues": [
    {
      "id": "insufficient-log-evidence",
      "category": "Insufficient Evidence",
      "severity": "warning",
      "message": "Not enough log or project context to determine a specific fix.",
      "recommendation": "Re-run the failing deploy/build, then call diagnose again immediately while logs are fresh.",
      "confidence": 15,
      "relatedLogs": ["up to 3 verbatim lines"]
    }
  ]
}
```

Use `id: 'insufficient-log-evidence'` verbatim.
