Respond with a single JSON object matching this shape:

```json
{
  "status": "failing",
  "primaryRecommendation": "Short imperative sentence describing the single most important fix",
  "issues": [
    {
      "id": "short-kebab-case-identifier",
      "category": "Human-readable category (e.g. 'Port Binding', 'Dependencies', 'Scripts')",
      "severity": "error",
      "message": "One-sentence summary of the guideline violation in the user's voice",
      "recommendation": "Imperative, specific fix grounded in the guideline (command, file path, or config change)",
      "confidence": 85,
      "relatedLogs": ["verbatim log line 1", "verbatim log line 2"]
    }
  ]
}
```

Rules:

- `status` is one of: `failing`, `degraded`, `unknown`, `healthy`.
- `severity` is one of: `error`, `warning`.
- `issues` MUST contain at least one entry.
- `confidence` is an integer 0–100. Use lower values when log evidence is sparse or ambiguous.
- `relatedLogs` is optional; include at most 3 entries per issue, taken verbatim from the logs.
- `confidence: 0` is reserved for the out-of-scope sentinel below. For sparse but tentative matches, use 10–30.

### Out-of-Scope Sentinel

If the logs do NOT map to any platform upload guideline (the error appears to be in the customer's application code), return exactly this shape:

```json
{
  "status": "unknown",
  "primaryRecommendation": "No platform guideline violation detected. The deployment error appears to be in the application code and is outside the scope of this diagnostic service.",
  "issues": [
    {
      "id": "no-platform-violation-detected",
      "category": "Out of Scope",
      "severity": "warning",
      "message": "Log evidence does not match any Node.js Hosting upload guideline. The failure appears to be an application-level error.",
      "recommendation": "Review the cited log lines manually; the fix is in your application code, not a platform requirement.",
      "confidence": 0,
      "relatedLogs": ["one or two verbatim lines that triggered the analysis"]
    }
  ]
}
```

Use the sentinel verbatim (same `id`, `category`, `severity`, `confidence`) so downstream clients can detect this case reliably.

### Insufficient-Evidence Response

If the logs exist but are too sparse or ambiguous to reach any conclusion (neither a guideline match nor a clear app-code failure), return this distinct shape:

```json
{
  "status": "unknown",
  "primaryRecommendation": "Logs do not contain enough evidence to diagnose. Re-run diagnosis with a wider time window or re-trigger the failure to produce more logs.",
  "issues": [
    {
      "id": "insufficient-log-evidence",
      "category": "Insufficient Evidence",
      "severity": "warning",
      "message": "Not enough log evidence to determine whether this is a platform guideline violation or an application-level error.",
      "recommendation": "Re-trigger the failure or widen the log window and retry.",
      "confidence": 15,
      "relatedLogs": ["up to 3 verbatim lines showing the ambiguity"]
    }
  ]
}
```

Use `id: 'insufficient-log-evidence'` verbatim so downstream clients can distinguish this case from the out-of-scope sentinel.
