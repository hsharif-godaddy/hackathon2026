## Eval results

- Scenario: `multipage-catalog`
- Trial: `10`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| intent-to-output-alignment | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.09 | TTFC=82474ms maxGap=106322ms total=493885ms chunks=83 turns=4 score=0.09 aabInit=73694ms aabTTFC=5464ms |
| output-quality | ⚠️ unknown | 0.00 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| token-usage | observed | 1073895.00 | aab=1073895 probe=85793 total=1159688 tokens |
| tool-batching-efficiency | observed | 1.00 | 41 successful calls across 1 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 41 tool call(s) |
| tool-parallelism | observed | 0.10 | Tool parallelism ratio: 10% |
| turn-duration | observed | 475652.00 | Total AAB duration: 475652ms across 4 turns (avg 118913ms) |
