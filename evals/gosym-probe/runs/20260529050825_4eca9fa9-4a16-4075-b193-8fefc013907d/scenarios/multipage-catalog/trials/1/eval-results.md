## Eval results

- Scenario: `multipage-catalog`
- Trial: `1`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| intent-to-output-alignment | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.43 | TTFC=54842ms maxGap=79372ms total=389087ms chunks=95 turns=4 score=0.43 aabInit=52507ms aabTTFC=2273ms |
| output-quality | ⚠️ unknown | 0.00 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | ⚠️ unknown | 0.00 | Evidence validation failed (snapshot unreadable or empty) |
| token-usage | observed | 1736419.00 | aab=1736419 probe=107780 total=1844199 tokens |
| tool-batching-efficiency | observed | 0.98 | 58 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.02 | 1/59 tool calls failed (2%): media-logo__generate_logo |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 377806.00 | Total AAB duration: 377806ms across 4 turns (avg 94452ms) |
