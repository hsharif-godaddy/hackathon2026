## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `6`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered site includes a detailed services section (3 service types with feature lists), prominent phone number (555) 867-5309 in header and hero with click-to-call, a 'Get a Free Quote' CTA, and… |
| intent-to-output-alignment | observed | 0.95 | The site includes a clear services section (Regular Cleaning, Deep Clean, Move-in/Move-out with staggered layout), the user's real phone number (555) 867-5309 prominently displayed in the header, her… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.15 | TTFC=62713ms maxGap=86270ms total=402543ms chunks=22 turns=5 score=0.15 aabInit=51943ms aabTTFC=10738ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.85 | The agent claimed the phone number (555) 867-5309 would appear everywhere — header, hero, contact section, and footer — and the final HTML confirms it in the header (`tel:+15558675309` with visible t… |
| token-usage | observed | 1231391.00 | aab=1231391 probe=56570 total=1287961 tokens |
| tool-batching-efficiency | observed | 0.91 | 33 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 33 tool call(s) |
| tool-parallelism | observed | 0.06 | Tool parallelism ratio: 6% |
| turn-duration | observed | 387219.00 | Total AAB duration: 387219ms across 6 turns (avg 64537ms) |
