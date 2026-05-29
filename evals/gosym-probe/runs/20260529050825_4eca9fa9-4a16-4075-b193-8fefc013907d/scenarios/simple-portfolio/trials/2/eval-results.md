## Eval results

- Scenario: `simple-portfolio`
- Trial: `2`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | The rendered HTML confirms all three required sections are present and populated with real content: Hero (Marcus Webb name, Austin TX tagline, 'Designing digital experiences that feel effortless.'), … |
| intent-to-output-alignment | observed | 0.95 | The final HTML confirms all three required sections are present and populated with Marcus Webb's real info: hero with name 'Marcus Webb' and tagline 'Designing digital experiences that feel effortles… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.43 | TTFC=45973ms maxGap=41085ms total=220891ms chunks=68 turns=3 score=0.43 aabInit=43523ms aabTTFC=2419ms |
| output-quality | pass | 0.85 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.85 | The final DOM confirms all three required sections are present and populated with Marcus Webb's real info: hero shows 'Marcus Webb' with the correct tagline, about section contains accurate 8-year UX… |
| token-usage | observed | 994853.00 | aab=994853 probe=32953 total=1027806 tokens |
| tool-batching-efficiency | observed | 0.96 | 25 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 25 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 210936.00 | Total AAB duration: 210936ms across 3 turns (avg 70312ms) |
