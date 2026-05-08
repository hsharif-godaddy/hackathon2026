# Phase 0: Gather Frontend Logs

Run this first:

```bash
bash /opt/skills/airo-log-investigate/run_search_frontend_logs.sh \
  --appId {appId} \
  --source airo-app-frontend \
  --window {timeWindow}
```

Use `24h` when no time window is provided. `airo-app-frontend` maps to the console API's `source=airo-app`. The script fetches all available logs for that app/time window to `/tmp/airo-log-investigate/{appId}/`, paginating every bucket and adaptively splitting failed buckets.

After it runs:

1. Read the printed TOON-style index.
2. If needed, read `/tmp/airo-log-investigate/{appId}/index.json`.
3. Drill into only relevant raw refs from the index.
4. If `coverage.incompleteBucketCount > 0`, include the incomplete buckets in Unknowns.

Do not run broad manual searches before this. Do not query other log sources in this PR's frontend-only mode.
