## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `11`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| intent-to-output-alignment | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| jtbd-completion | partial | 0.50 | LLM judge verdict: partial |
| latency | observed | 0.03 | TTFC=87204ms maxGap=111657ms total=654096ms chunks=36 turns=5 score=0.03 aabInit=61420ms aabTTFC=25756ms |
| output-quality | ⚠️ unknown | 0.00 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| token-usage | observed | 1580372.00 | aab=1580372 probe=52081 total=1632453 tokens |
| tool-batching-efficiency | observed | 0.94 | 32 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 32 tool call(s) |
| tool-parallelism | observed | 0.08 | Tool parallelism ratio: 8% |
| turn-duration | observed | 634461.00 | Total AAB duration: 634461ms across 6 turns (avg 105744ms) |
