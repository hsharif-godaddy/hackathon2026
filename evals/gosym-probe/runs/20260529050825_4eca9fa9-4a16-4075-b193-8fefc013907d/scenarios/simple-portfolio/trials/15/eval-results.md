## Eval results

- Scenario: `simple-portfolio`
- Trial: `15`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections are fully rendered: hero with 'Jordan Ellis' and tagline 'Designing experiences that feel effortless.', about section with 8 years UX experience, Austin TX location, start… |
| intent-to-output-alignment | observed | 0.95 | All three required sections (hero, about, contact) are present with Jordan Ellis's real info: correct name and tagline in hero, 8-year UX background with startup/Fortune 500/Austin TX details in abou… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.01 | TTFC=50276ms maxGap=102801ms total=320553ms chunks=28 turns=2 score=0.01 aabInit=41470ms aabTTFC=8773ms |
| output-quality | pass | 0.85 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.85 | The final DOM confirms all three required sections are present and populated with real user data: hero shows 'Jordan Ellis.' with tagline 'Designing experiences that feel effortless.', about section … |
| token-usage | observed | 1076823.00 | aab=1076823 probe=18240 total=1095063 tokens |
| tool-batching-efficiency | observed | 0.96 | 28 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 28 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 315458.00 | Total AAB duration: 315458ms across 2 turns (avg 157729ms) |
