# BackgroundSummarizer Memory Benchmark

Measures peak memory usage during conversation summarization to verify memory optimizations.

## What It Tests

1. **Full mode vs Incremental mode** - Incremental should use less memory
2. **Memory scaling** - Should scale with NEW messages, not total messages
3. **Selective loading** - Should load only necessary messages

## Quick Start

```bash
# From repo root
pnpm --filter @airo/agents benchmark:memory

# With explicit GC for more accurate measurements
pnpm --filter @airo/agents benchmark:memory:gc
```

## Expected Results

✅ **Good Performance Indicators:**

- Incremental mode (100 new / 5000 total) uses <20% of full mode (5000) memory
- Memory scales ~5x when going from 100 → 500 new messages (linear scaling)
- Peak memory stays under 100MB for incremental mode

⚠️ **Performance Issues:**

- Incremental mode uses >50% of full mode memory (not loading selectively)
- Memory scales >10x when going from 100 → 500 new messages (loading all messages)
- Peak memory exceeds 500MB (memory leak or inefficient loading)

## Benchmark Scenarios

| Scenario               | Total Messages | New Messages | Purpose                                      |
| ---------------------- | -------------- | ------------ | -------------------------------------------- |
| Full - Small           | 500            | 500          | Baseline for small conversations             |
| Full - Large           | 5000           | 5000         | Worst case (no existing summary)             |
| Incremental - 100/5000 | 5100           | 100          | Best case (most messages already summarized) |
| Incremental - 500/5000 | 5500           | 500          | Typical case (moderate new messages)         |

## Comparing Branches

To compare memory usage before/after your changes:

```bash
# Benchmark main branch
git checkout main
pnpm --filter @airo/agents benchmark:memory > /tmp/baseline.txt

# Benchmark your PR branch
git checkout your-branch
pnpm --filter @airo/agents benchmark:memory > /tmp/pr.txt

# Compare
diff /tmp/baseline.txt /tmp/pr.txt
```

## Understanding Output

```
📊 RESULTS SUMMARY

┌─────────────────────────────────────────┬──────────┬──────────┬──────────┬───────────┬─────────┐
│ Scenario                                │ Messages │ New Msgs │ Delta MB │ Peak MB   │ Time ms │
├─────────────────────────────────────────┼──────────┼──────────┼──────────┼───────────┼─────────┤
│ Incremental Mode - 100 new / 5000 total│     5100 │      100 │     8.5  │     45.2  │      12 │
└─────────────────────────────────────────┴──────────┴──────────┴──────────┴───────────┴─────────┘
```

- **Delta MB**: Memory allocated during summarization (lower is better)
- **Peak MB**: Maximum heap size reached (indicates memory pressure)
- **Time ms**: Duration in milliseconds (should be fast for incremental)

## Troubleshooting

### "WARNING: Running without --expose-gc flag"

Not critical, but memory measurements will be less accurate. Run with:

```bash
node --expose-gc --require tsx/register agents/src/services/summarization/__benchmarks__/memory-benchmark.ts
```

### High memory usage in incremental mode

Check logs to confirm it's using incremental mode:

- Look for "incremental_mode_attempt" log messages
- Verify `getMessagesAfterMessageId` is being called
- Check that existing summary reference exists

### Inconsistent results

- Close other applications to reduce noise
- Run multiple times and average results
- Use `--max-old-space-size` flag to set heap limit:
  ```bash
  node --max-old-space-size=512 --expose-gc ...
  ```

## CI Integration

Add to CI to catch memory regressions:

```yaml
- name: Run memory benchmark
  run: pnpm --filter @airo/agents benchmark:memory

- name: Check memory threshold
  run: |
    # Fail if incremental mode uses >50MB delta
    # (add custom threshold checking logic)
```

## Next Steps

After validating with synthetic benchmark:

1. Add production telemetry (see `MEMORY-OPTIMIZATION-OPPORTUNITIES.md`)
2. Monitor real-world metrics in staging
3. Set up alerts for memory regression
