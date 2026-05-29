## Eval results

- Scenario: `simple-portfolio`
- Trial: `3`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections (hero with name and tagline, about with bio and tech stack, contact with email link and social media icons for GitHub/LinkedIn/Twitter) are present and rendered in the DOM… |
| intent-to-output-alignment | observed | 0.95 | All three required sections (hero with 'Alex Rivera' name and tagline, about with background bio, contact with email link and GitHub/LinkedIn/Twitter icons) are confirmed present in the final HTML. M… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.01 | TTFC=51731ms maxGap=74157ms total=207573ms chunks=16 turns=2 score=0.01 aabInit=49083ms aabTTFC=2610ms |
| output-quality | pass | 0.85 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.82 | The final HTML snapshot confirms all three required sections are present and populated: a hero section with 'Alex Rivera' and tagline, an about section with bio text and tech stack tags, and a contac… |
| token-usage | observed | 451986.00 | aab=451986 probe=11471 total=463457 tokens |
| tool-batching-efficiency | observed | 0.94 | 17 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 17 tool call(s) |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 202274.00 | Total AAB duration: 202274ms across 3 turns (avg 67425ms) |
