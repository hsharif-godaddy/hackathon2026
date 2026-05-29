## Eval results

- Scenario: `simple-portfolio`
- Trial: `7`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.88 | 5 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | The rendered HTML confirms all three required sections are present and content-rich: a hero with 'Marcus Webb' name and tagline 'Freelance Graphic Designer — crafting visual identities that endure'; … |
| intent-to-output-alignment | observed | 1.00 | All three required sections are present and fully implemented: hero with 'Marcus Webb' name and tagline, about section with background copy and disciplines, and contact section with email link (hello… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.07 | TTFC=53077ms maxGap=128168ms total=740542ms chunks=102 turns=4 score=0.07 aabInit=49282ms aabTTFC=2923ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.88 | 5 user turns |
| silent-hallucination | observed | 0.92 | The final HTML snapshot confirms all three required sections are present and populated: a hero section with 'Marcus Webb' and tagline, an about section (id='about') with background copy and disciplin… |
| token-usage | observed | 2553091.00 | aab=2553091 probe=61222 total=2614313 tokens |
| tool-batching-efficiency | observed | 0.92 | 52 successful calls across 5 productive turns |
| tool-failure-rate | observed | 0.04 | 2/54 tool calls failed (4%): str_replace_based_edit_tool |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 724511.00 | Total AAB duration: 724511ms across 5 turns (avg 144902ms) |
