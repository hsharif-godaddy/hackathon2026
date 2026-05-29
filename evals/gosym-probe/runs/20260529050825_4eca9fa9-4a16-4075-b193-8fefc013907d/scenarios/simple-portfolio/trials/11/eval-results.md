## Eval results

- Scenario: `simple-portfolio`
- Trial: `11`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections (hero, about, contact) are fully rendered in the DOM with real user content: Jordan Blake's name and tagline in the hero, detailed bio with 8 years of design experience in… |
| intent-to-output-alignment | observed | 0.95 | The final HTML snapshot shows all three required sections rendered: a hero with 'Jordan Blake' and tagline 'Designing brands that mean something.', an about section with 8-year freelance graphic desi… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=93373ms maxGap=114265ms total=487484ms chunks=40 turns=2 score=0.00 aabInit=87386ms aabTTFC=5662ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.85 | The final DOM confirms all three required sections (hero with 'Jordan Blake' and tagline 'Designing brands that mean something.', about section with bio, contact section with jordan@jordanblakedesign… |
| token-usage | observed | 1196401.00 | aab=1196401 probe=18400 total=1214801 tokens |
| tool-batching-efficiency | observed | 0.97 | 32 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 32 tool call(s) |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 475431.00 | Total AAB duration: 475431ms across 2 turns (avg 237716ms) |
