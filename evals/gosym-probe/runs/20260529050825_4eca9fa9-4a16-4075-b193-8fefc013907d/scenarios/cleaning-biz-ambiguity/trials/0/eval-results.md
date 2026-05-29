## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `0`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.73 | 10 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.85 | The rendered homepage includes a clear services section (Regular, Deep, Move-In/Out cleaning with descriptions), contact info prominently placed in the header (phone number '(555) 123-4567' visible o… |
| intent-to-output-alignment | observed | 0.92 | The final site clearly matches the user's intent: a simple cleaning business website with a services section (Regular, Deep, Move-In/Out visible in the HTML body), contact information (phone number '… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.47 | TTFC=46606ms maxGap=70545ms total=533662ms chunks=109 turns=9 score=0.47 aabInit=44217ms aabTTFC=2356ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.73 | 10 user turns |
| silent-hallucination | observed | 0.85 | Agent claims about services section and contact info are fully backed by evidence: the final HTML snapshot shows three service cards (Regular, Deep, Move-In/Out) with descriptions, and the header con… |
| token-usage | observed | 2249023.00 | aab=2249023 probe=81684 total=2330707 tokens |
| tool-batching-efficiency | observed | 0.88 | 43 successful calls across 6 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 43 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 508553.00 | Total AAB duration: 508553ms across 10 turns (avg 50855ms) |
