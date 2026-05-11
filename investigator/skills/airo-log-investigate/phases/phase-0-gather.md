# Phase 0: Gather Multi-Source Evidence

Run this first:

```bash
bash /opt/skills/airo-log-investigate/run_search_frontend_logs.sh \
  --appId {appId} \
  --window {timeWindow}
```

Use `24h` when no time window is provided. The script calls the console-owned `/api/investigate-evidence` endpoint for `airo-app`, `control_plane`, `airo-agents`, `airo-preview`, `airo-publish`, `langfuse`, and `fullstory`, then writes the bundle to `/tmp/airo-log-investigate/{appId}/`. Each source gets its own compact index and raw page files. Pass `--fullstory-url {url}` when a session URL was provided in the feedback so FullStory fetches that exact session instead of running segment discovery.

After it runs:

1. Read the printed TOON-style index.
2. If needed, read `/tmp/airo-log-investigate/{appId}/evidence.json`.
3. Drill into only relevant raw refs from the index.
4. If any source has `coverage.incompleteBucketCount > 0`, include the incomplete buckets in Unknowns.

Do not run broad manual searches before this. Use the indexes first and raw refs second.
