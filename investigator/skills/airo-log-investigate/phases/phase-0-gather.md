# Phase 0: Gather Multi-Source Evidence

Run this first:

```bash
bash /opt/skills/airo-log-investigate/run_search_frontend_logs.sh \
  --appId {appId} \
  --window {timeWindow}
```

Use `24h` when no time window is provided. The script calls the console-owned `/api/investigate-evidence` endpoint for `airo-app`, `control_plane`, `airo-agents`, `airo-preview`, and `airo-publish`, then writes the bundle to `/tmp/airo-log-investigate/{appId}/`. Each source gets its own compact index and raw page files.

After it runs:

1. Read the printed TOON-style index.
2. If needed, read `/tmp/airo-log-investigate/{appId}/evidence.json`.
3. Drill into only relevant raw refs from the index. Use `fetch_log_lines` to pull specific lines for a source once the index points you at them.
4. If any source has `coverage.incompleteBucketCount > 0`, include the incomplete buckets in Unknowns.

Then read the non-log evidence:

5. Read the customer app code at `$APP_CODE_DIR` (Read/Grep/Glob) for the files implicated by the logs.
6. Read the agent conversation transcript at `$CONVERSATIONS_PATH` to see what the customer asked and what the agent attempted.
7. For structural code questions (callers, callees, imports, impact), go through the code-review-graph MCP rather than scanning files by hand.

Do not run broad manual searches before this. Run the log search first, read the index, then drill via `fetch_log_lines` and raw refs second.
