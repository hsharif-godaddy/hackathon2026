## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `9`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.88 | 5 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered site includes a clear services section with 4 named cleaning services (Standard Clean, Deep Clean, Move-In/Move-Out, Recurring Service), contact information with phone number (555) 867-5… |
| intent-to-output-alignment | observed | 0.95 | The site clearly includes a services section with four named cleaning services (Standard Clean, Deep Clean, Move-In/Move-Out, Recurring Service), and contact information is prominently displayed in t… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.06 | TTFC=86465ms maxGap=116568ms total=663251ms chunks=53 turns=3 score=0.06 aabInit=55781ms aabTTFC=28327ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.88 | 5 user turns |
| silent-hallucination | observed | 0.95 | Agent claimed phone number (555) 867-5309 appears in hero, CTA, footer, and contact page — the final HTML confirms it directly in the hero section as a tel: link and as visible text. Agent claimed a … |
| token-usage | observed | 1922196.00 | aab=1922196 probe=50591 total=1972787 tokens |
| tool-batching-efficiency | observed | 0.93 | 41 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 41 tool call(s) |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 613159.00 | Total AAB duration: 613159ms across 5 turns (avg 122632ms) |
