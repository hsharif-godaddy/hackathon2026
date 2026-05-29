## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `17`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.77 | 9 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered site clearly contains a services section on the homepage (Standard Clean, Deep Clean, Move-In/Move-Out cards with descriptions and feature lists) plus a dedicated /services page with fou… |
| intent-to-output-alignment | observed | 0.93 | The final site clearly matches the user's stated goals: it includes a services section (Standard Clean, Deep Clean, Move-In/Move-Out cards on homepage plus a full /services page), contact information… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.21 | TTFC=67663ms maxGap=107535ms total=729488ms chunks=85 turns=7 score=0.21 aabInit=44832ms aabTTFC=22798ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.77 | 9 user turns |
| silent-hallucination | observed | 0.82 | Agent claims about services section, contact information, and phone number are all confirmed in the final DOM: services grid (Standard Clean, Deep Clean, Move-In/Move-Out) renders in the HTML, phone … |
| token-usage | observed | 2879375.00 | aab=2879375 probe=156824 total=3036199 tokens |
| tool-batching-efficiency | observed | 0.92 | 54 successful calls across 5 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 54 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 705319.00 | Total AAB duration: 705319ms across 9 turns (avg 78369ms) |
