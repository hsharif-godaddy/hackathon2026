## Eval results

- Scenario: `simple-portfolio`
- Trial: `12`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | All three required sections are fully rendered with real user content: hero with Jordan Rivera's name and tagline, about with detailed 6-year UX/UI bio and skills grid, and contact with styled email … |
| intent-to-output-alignment | observed | 0.92 | The final HTML confirms all three required sections are present: a hero section with 'Jordan Rivera' and the exact tagline 'Designing digital experiences that connect and inspire.', an about section … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=78628ms maxGap=68522ms total=492042ms chunks=33 turns=2 score=0.00 aabInit=58468ms aabTTFC=20158ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.85 | The final DOM confirms all three required sections are present and populated with Jordan Rivera's real info: hero with name and tagline 'Designing digital experiences that connect and inspire.', abou… |
| token-usage | observed | 1298469.00 | aab=1298469 probe=16808 total=1315277 tokens |
| tool-batching-efficiency | observed | 0.97 | 34 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.03 | 1/35 tool calls failed (3%): str_replace_based_edit_tool |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 483109.00 | Total AAB duration: 483109ms across 2 turns (avg 241555ms) |
