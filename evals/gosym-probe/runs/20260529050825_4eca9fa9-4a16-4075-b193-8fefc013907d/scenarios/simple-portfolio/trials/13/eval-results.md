## Eval results

- Scenario: `simple-portfolio`
- Trial: `13`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | All three required sections are fully rendered: Hero with 'Alex Jordan' and 'Full-Stack Developer & UI Designer' tagline, About with the 8-years/Chicago/clean-interfaces bio plus skills list, and Con… |
| intent-to-output-alignment | observed | 0.95 | All three required sections are present in the DOM: hero shows 'Alex Jordan' and 'Full-Stack Developer & UI Designer'; about contains the 8-year Chicago developer bio matching user specs; contact has… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=66660ms maxGap=85599ms total=403677ms chunks=22 turns=2 score=0.00 aabInit=62944ms aabTTFC=3683ms |
| output-quality | pass | 0.84 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.82 | The final DOM confirms hero ('Alex Jordan', 'Full-Stack Developer & UI Designer'), about (8 years, Chicago, clean interfaces/scalable code), and contact (email link, GitHub/LinkedIn/Twitter/Dribbble … |
| token-usage | observed | 723537.00 | aab=723537 probe=12820 total=736357 tokens |
| tool-batching-efficiency | observed | 0.95 | 23 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 23 tool call(s) |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 390219.00 | Total AAB duration: 390219ms across 2 turns (avg 195110ms) |
