## Eval results

- Scenario: `simple-portfolio`
- Trial: `17`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | All three required sections are present and fully rendered in the DOM: hero with name 'Alex Morgan' and tagline, about section with background bio and skills grid, and contact section with a mailto l… |
| intent-to-output-alignment | observed | 0.85 | The final HTML snapshot confirms all three required sections are present: a hero section with name 'Alex Morgan' and tagline, an about section with background bio and skills, and a contact section wi… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.01 | TTFC=46624ms maxGap=41762ms total=146304ms chunks=39 turns=2 score=0.01 aabInit=44108ms aabTTFC=2483ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.82 | The final HTML snapshot confirms all three required sections (hero with name/tagline, about with bio/skills, contact with email link and social icons) are present and rendered. Tool calls substantiat… |
| token-usage | observed | 479179.00 | aab=479179 probe=9309 total=488488 tokens |
| tool-batching-efficiency | observed | 1.00 | 15 successful calls across 1 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 15 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 144082.00 | Total AAB duration: 144082ms across 2 turns (avg 72041ms) |
