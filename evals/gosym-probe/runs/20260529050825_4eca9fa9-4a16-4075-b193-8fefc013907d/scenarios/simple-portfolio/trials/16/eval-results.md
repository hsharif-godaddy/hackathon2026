## Eval results

- Scenario: `simple-portfolio`
- Trial: `16`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | All three required sections are fully rendered: Hero with Alex Rivera's name and tagline 'Designing experiences that feel effortless.', About with 8-year UX background and portrait photo, and Contact… |
| intent-to-output-alignment | observed | 0.95 | The final HTML confirms all three required sections are present and populated with the correct personalized content: hero section with 'Alex Rivera' and tagline 'Designing experiences that feel effor… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.20 | TTFC=49850ms maxGap=57630ms total=268989ms chunks=75 turns=3 score=0.20 aabInit=42425ms aabTTFC=7385ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.85 | The agent claimed to build a hero section (name + tagline), about section (bio, portrait, background details), and contact section (email link, LinkedIn, Dribbble icons) — all are confirmed present i… |
| token-usage | observed | 1452671.00 | aab=1452671 probe=29632 total=1482303 tokens |
| tool-batching-efficiency | observed | 0.97 | 33 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.06 | 2/35 tool calls failed (6%): str_replace_based_edit_tool |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 259489.00 | Total AAB duration: 259489ms across 3 turns (avg 86496ms) |
