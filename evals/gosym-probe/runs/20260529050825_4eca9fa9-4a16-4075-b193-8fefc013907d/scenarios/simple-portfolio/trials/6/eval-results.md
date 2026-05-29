## Eval results

- Scenario: `simple-portfolio`
- Trial: `6`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections are fully rendered: Hero with 'Alex Morgan' name and tagline 'Designer & Creative Director crafting bold visual experiences'; About with 10-year background, startup/Fortun… |
| intent-to-output-alignment | observed | 0.95 | The final HTML confirms all three required sections are present and correctly populated: Hero with 'Alex Morgan' in oversized display type and the exact tagline 'Designer & Creative Director crafting… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=56168ms maxGap=128061ms total=379507ms chunks=36 turns=2 score=0.00 aabInit=51175ms aabTTFC=4988ms |
| output-quality | pass | 0.85 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.85 | All three claimed sections (hero with 'Alex Morgan' name and tagline, about with 10-year background and Fortune 500 mention, contact with alex@alexmorgan.co and three social links) are verified in th… |
| token-usage | observed | 1001783.00 | aab=1001783 probe=18218 total=1020001 tokens |
| tool-batching-efficiency | observed | 0.96 | 28 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 28 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 374603.00 | Total AAB duration: 374603ms across 2 turns (avg 187302ms) |
