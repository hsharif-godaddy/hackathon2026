## Eval results

- Scenario: `simple-portfolio`
- Trial: `5`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.90 | Hero section renders with name, tagline, and CTAs; about section includes bio, background, skills tags; contact section confirmed with email link and LinkedIn/Dribbble icons per agent response. Minor… |
| intent-to-output-alignment | observed | 0.88 | Hero has Alex Morgan's name, correct tagline, and Austin TX location; About section contains 8-year background, correct specializations, and skill tags; contact section with email and social links co… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=50328ms maxGap=86372ms total=396911ms chunks=49 turns=2 score=0.00 aabInit=47422ms aabTTFC=2874ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.82 | All three required sections (hero, about, contact) are present and verified in the final HTML with real content (Alex Morgan, tagline 'Designing experiences that feel effortless.', email alex@alexmor… |
| token-usage | observed | 1382096.00 | aab=1382096 probe=23906 total=1406002 tokens |
| tool-batching-efficiency | observed | 0.97 | 36 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 36 tool call(s) |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 391056.00 | Total AAB duration: 391056ms across 2 turns (avg 195528ms) |
