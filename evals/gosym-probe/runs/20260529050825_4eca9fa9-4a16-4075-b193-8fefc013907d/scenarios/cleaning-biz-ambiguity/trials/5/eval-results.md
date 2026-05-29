## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `5`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.83 | 7 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.90 | The rendered homepage clearly shows a services section with three named services (Standard Clean, Deep Clean, Move-In/Move-Out), contact info (phone number (555) 000-1234) in the header and hero CTA … |
| intent-to-output-alignment | observed | 0.95 | The final site clearly meets all scenario goals: it has a services section (Standard Clean, Deep Clean, Move-In/Move-Out with photos and descriptions), prominent contact information ((555) 000-1234 i… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.23 | TTFC=53221ms maxGap=87633ms total=542902ms chunks=54 turns=6 score=0.23 aabInit=50699ms aabTTFC=2488ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.83 | 7 user turns |
| silent-hallucination | observed | 0.85 | Agent claims about placeholder phone number (555) 000-1234 are confirmed in the final HTML with `tel:+15550001234` links in both header and hero section. Services section with Standard Clean, Deep Cl… |
| token-usage | observed | 1693642.00 | aab=1693642 probe=57063 total=1750705 tokens |
| tool-batching-efficiency | observed | 0.91 | 36 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 36 tool call(s) |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 520083.00 | Total AAB duration: 520083ms across 7 turns (avg 74298ms) |
