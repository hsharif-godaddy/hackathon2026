## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `7`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered HTML confirms a services section with four named cleaning services (Standard Clean, Deep Clean, Move-In/Move-Out, Recurring), prominent phone number (555) 123-4567 in the header and hero… |
| intent-to-output-alignment | observed | 0.92 | The site clearly satisfies the scenario goals: it infers cleaning business basics from vague input, builds a services section (Standard Clean, Deep Clean, Move-In/Move-Out, Recurring), and includes p… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.26 | TTFC=55117ms maxGap=96919ms total=493847ms chunks=56 turns=5 score=0.26 aabInit=44586ms aabTTFC=9879ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.82 | The agent claimed the phone number (555) 123-4567 appears in the header, hero section, and CTA — all three are confirmed in the final HTML with working tel: links. The agent claimed a Contact page wi… |
| token-usage | observed | 1411625.00 | aab=1411625 probe=58148 total=1469773 tokens |
| tool-batching-efficiency | observed | 0.91 | 33 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 33 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 478056.00 | Total AAB duration: 478056ms across 6 turns (avg 79676ms) |
