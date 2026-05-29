## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `10`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered HTML confirms a services section with three service types (Standard Clean, Deep Clean, Move-In/Move-Out), a prominent phone number (555) 867-5309 in the header and hero CTA, trust signal… |
| intent-to-output-alignment | observed | 0.95 | The site fully delivers on the scenario goals: a services section with Standard Clean, Deep Clean, and Move-In/Move-Out cards is present in the DOM, the correct phone number (555) 867-5309 appears in… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.02 | TTFC=93586ms maxGap=83326ms total=655680ms chunks=38 turns=5 score=0.02 aabInit=84633ms aabTTFC=6590ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.85 | All major agent claims are backed by observable evidence: (1) The agent claimed phone number (555) 867-5309 was updated everywhere, and the final HTML confirms `tel:+15558675309` appears in both the … |
| token-usage | observed | 1408210.00 | aab=1408210 probe=52062 total=1460272 tokens |
| tool-batching-efficiency | observed | 0.91 | 33 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 33 tool call(s) |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 621493.00 | Total AAB duration: 621493ms across 6 turns (avg 103582ms) |
