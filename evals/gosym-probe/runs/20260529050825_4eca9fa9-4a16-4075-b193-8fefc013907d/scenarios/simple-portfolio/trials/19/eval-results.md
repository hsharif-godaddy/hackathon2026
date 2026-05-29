## Eval results

- Scenario: `simple-portfolio`
- Trial: `19`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections are present with real content: hero with Alex Morgan's name and tagline, about section with 8-year UX background and skills list, and contact section with alex@alexmorgand… |
| intent-to-output-alignment | observed | 0.95 | All three required sections are present: hero with 'Alex Morgan' and tagline 'Designing experiences that connect people and products.', about section with 8-year UX background content, and contact se… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.01 | TTFC=49435ms maxGap=86133ms total=368022ms chunks=37 turns=2 score=0.01 aabInit=46167ms aabTTFC=2493ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.82 | All agent claims are backed by observable evidence: (1) The hero section with 'Alex Morgan' name and tagline 'Designing experiences that connect people and products.' is confirmed in the DOM/body tex… |
| token-usage | observed | 1335538.00 | aab=1335538 probe=23436 total=1358974 tokens |
| tool-batching-efficiency | observed | 0.97 | 31 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.03 | 1/32 tool calls failed (3%): str_replace_based_edit_tool |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 360531.00 | Total AAB duration: 360531ms across 2 turns (avg 180266ms) |
