## Eval results

- Scenario: `simple-portfolio`
- Trial: `18`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | All three required sections render with real user data: hero shows 'Sarah Chen' and correct tagline, about section includes 8-year background with skill tags, contact section has a functional mailto … |
| intent-to-output-alignment | observed | 0.95 | The final HTML snapshot contains all three required sections (hero with 'Sarah Chen' and tagline 'Designing experiences that feel effortless.', about section with 8-year UX background in Austin TX, c… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.01 | TTFC=55752ms maxGap=114941ms total=446402ms chunks=70 turns=2 score=0.01 aabInit=47639ms aabTTFC=8081ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.85 | Agent claims are well-supported by artifacts: the final HTML confirms 'Sarah Chen' name, tagline 'Designing experiences that feel effortless', About section with 8-year UX background in Austin TX, an… |
| token-usage | observed | 1356530.00 | aab=1356530 probe=18357 total=1374887 tokens |
| tool-batching-efficiency | observed | 0.97 | 34 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 34 tool call(s) |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 440588.00 | Total AAB duration: 440588ms across 2 turns (avg 220294ms) |
