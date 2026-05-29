## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `2`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.83 | 7 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The site includes a clear services section with 4 named cleaning types (Standard Clean, Deep Clean, Move-In/Move-Out, Regular Maintenance), the phone number (555) 867-5309 is prominently displayed in… |
| intent-to-output-alignment | observed | 0.95 | The site includes a clear services section with Standard Clean, Deep Clean, Move-In/Move-Out, and Regular Maintenance presented in staggered layout, and the phone number (555) 867-5309 appears promin… |
| jtbd-completion | partial | 0.50 | LLM judge verdict: partial |
| latency | observed | 0.28 | TTFC=58135ms maxGap=61204ms total=316910ms chunks=40 turns=5 score=0.28 aabInit=50372ms aabTTFC=7455ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.83 | 7 user turns |
| silent-hallucination | observed | 0.82 | Agent claims phone number appears in header, CTA section, and footer — all three are confirmed in the final HTML (tel:+15558675309 in header, visible in body text). Services section with 4 service ty… |
| token-usage | observed | 1702076.00 | aab=1702076 probe=59480 total=1761556 tokens |
| tool-batching-efficiency | observed | 0.91 | 36 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.10 | 4/40 tool calls failed (10%): media-logo__generate_logo |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 300839.00 | Total AAB duration: 300839ms across 7 turns (avg 42977ms) |
