## Eval results

- Scenario: `simple-portfolio`
- Trial: `9`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.88 | 5 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | All three required sections (hero with name/tagline, about with background/skills, contact with email link and social icons) are fully rendered in the DOM snapshot. Real personal details (Sarah Bloom… |
| intent-to-output-alignment | observed | 0.95 | The final HTML snapshot clearly shows all three required sections: a hero with 'Sarah Bloom.' and 'Designer & Creative Director' tagline, an About section with background bio and skill tags, and a Co… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.02 | TTFC=64242ms maxGap=61911ms total=686110ms chunks=90 turns=5 score=0.02 aabInit=53999ms aabTTFC=10241ms |
| output-quality | pass | 0.84 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.88 | 5 user turns |
| silent-hallucination | observed | 0.82 | The final HTML snapshot confirms all three required sections (hero with 'Sarah Bloom' and 'Designer & Creative Director', about with bio and skills, contact with email and social links) are present a… |
| token-usage | observed | 2858453.00 | aab=2858453 probe=77949 total=2936402 tokens |
| tool-batching-efficiency | observed | 0.95 | 58 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 58 tool call(s) |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 655618.00 | Total AAB duration: 655618ms across 5 turns (avg 131124ms) |
