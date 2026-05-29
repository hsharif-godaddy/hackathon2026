## Eval results

- Scenario: `simple-portfolio`
- Trial: `10`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections (hero, about, contact) are rendered with Jordan Reeves' real info: name and tagline in hero, 6-year background and skills in about, email link and GitHub/LinkedIn icons in… |
| intent-to-output-alignment | observed | 0.95 | All three required sections are present in the final HTML: hero with 'Jordan Reeves.' and correct tagline, about section with 6 years of graphic design experience and relevant skills, and contact sec… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.05 | TTFC=73724ms maxGap=98240ms total=576086ms chunks=39 turns=3 score=0.05 aabInit=60875ms aabTTFC=10954ms |
| output-quality | pass | 0.84 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.82 | The final DOM snapshot confirms Jordan Reeves' name, tagline 'Crafting brands that people remember.', hero section, about section with 6 years/brand identity background, and contact section with jord… |
| token-usage | observed | 1890775.00 | aab=1890775 probe=43422 total=1934197 tokens |
| tool-batching-efficiency | observed | 0.97 | 40 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.05 | 2/42 tool calls failed (5%): str_replace_based_edit_tool |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 557327.00 | Total AAB duration: 557327ms across 3 turns (avg 185776ms) |
