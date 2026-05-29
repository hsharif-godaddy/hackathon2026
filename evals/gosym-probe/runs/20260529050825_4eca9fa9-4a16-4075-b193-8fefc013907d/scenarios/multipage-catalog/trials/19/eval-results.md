## Eval results

- Scenario: `multipage-catalog`
- Trial: `19`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| intent-to-output-alignment | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| jtbd-completion | ⚠️ unknown | 0.00 | LLM judge verdict: unknown |
| latency | observed | 0.21 | TTFC=67817ms maxGap=93616ms total=437874ms chunks=60 turns=4 score=0.21 aabInit=57851ms aabTTFC=9962ms |
| output-quality | ⚠️ unknown | 0.00 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| token-usage | observed | 1205388.00 | aab=1205388 probe=102380 total=1307768 tokens |
| tool-batching-efficiency | observed | 1.00 | 49 successful calls across 1 productive turns |
| tool-failure-rate | observed | 0.04 | 2/51 tool calls failed (4%): media |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 421911.00 | Total AAB duration: 421911ms across 4 turns (avg 105478ms) |
