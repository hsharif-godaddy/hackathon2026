Respond with a single JSON object matching this shape:

```json
{
  "status": "failing",
  "primaryRecommendation": "Short imperative sentence describing the single most important fix",
  "issues": [
    {
      "id": "short-kebab-case-identifier",
      "category": "Human-readable category (e.g. 'Missing Dependency', 'Port Binding')",
      "severity": "error",
      "message": "One-sentence summary of the problem in the user's voice",
      "recommendation": "Imperative, specific fix (command, file path, or config change)",
      "confidence": 85,
      "relatedLogs": ["verbatim log line 1", "verbatim log line 2"]
    }
  ]
}
```

Rules:

- `status` is one of: `failing`, `degraded`, `unknown`, `healthy`.
- `severity` is one of: `error`, `warning`.
- `issues` MUST contain at least one entry. If nothing is wrong, set `status: "healthy"` with a single informational warning-severity issue explaining why.
- `confidence` is an integer 0–100. Use lower values when log evidence is sparse or ambiguous.
- `relatedLogs` is optional; include at most 3 entries per issue, taken verbatim from the logs.
