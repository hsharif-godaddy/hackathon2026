## Eval results

- Scenario: `simple-portfolio`
- Trial: `14`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections are present and content-rich in the rendered DOM: Hero with Sarah Mitchell's name and 'UX Designer & Storyteller' tagline, About with 6+ year bio text, and Contact with em… |
| intent-to-output-alignment | observed | 0.95 | The final HTML snapshot confirms all three required sections: a hero with 'Sarah Mitchell' in large display type and 'UX Designer & Storyteller' tagline, an about section with background bio text, an… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.49 | TTFC=4255ms maxGap=103929ms total=275277ms chunks=47 turns=2 score=0.49 aabInit=1770ms aabTTFC=2453ms aabWorstGap=93566ms |
| output-quality | pass | 0.81 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.82 | The final HTML snapshot confirms all three required sections are present and populated: a hero section with 'Sarah Mitchell' and 'UX Designer & Storyteller' tagline, an about section with bio text, a… |
| token-usage | observed | 651654.00 | aab=651654 probe=16644 total=668298 tokens |
| tool-batching-efficiency | observed | 0.95 | 23 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.04 | 1/24 tool calls failed (4%): askQuestion |
| tool-parallelism | observed | 0.06 | Tool parallelism ratio: 6% |
| turn-duration | observed | 270440.00 | Total AAB duration: 270440ms across 3 turns (avg 90147ms) |
