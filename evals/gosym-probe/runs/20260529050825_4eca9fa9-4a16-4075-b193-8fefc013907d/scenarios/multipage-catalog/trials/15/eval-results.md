## Eval results

- Scenario: `multipage-catalog`
- Trial: `15`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| intent-to-output-alignment | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.31 | TTFC=58459ms maxGap=126172ms total=441122ms chunks=110 turns=4 score=0.31 aabInit=55795ms aabTTFC=2633ms |
| output-quality | ⚠️ unknown | 0.00 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| token-usage | observed | 1206386.00 | aab=1206386 probe=79840 total=1286226 tokens |
| tool-batching-efficiency | observed | 0.97 | 37 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 37 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 429485.00 | Total AAB duration: 429485ms across 4 turns (avg 107371ms) |
