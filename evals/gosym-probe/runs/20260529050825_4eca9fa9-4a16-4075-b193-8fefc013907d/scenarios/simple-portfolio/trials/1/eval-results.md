## Eval results

- Scenario: `simple-portfolio`
- Trial: `1`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections are present and populated with real user data: Hero shows 'Jordan Ellis' with correct tagline, About has full bio with 8 years UX experience and discipline tags, Contact s… |
| intent-to-output-alignment | observed | 0.95 | All three required sections are present and populated with real user data: hero shows 'Jordan Ellis.' with the exact tagline, about section includes 8-year UX designer bio, and contact section has em… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=46015ms maxGap=103447ms total=347473ms chunks=49 turns=2 score=0.00 aabInit=43272ms aabTTFC=2710ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.82 | The final DOM clearly shows Jordan Ellis's name, tagline 'Designing experiences people actually enjoy using.', an about section with 8-year UX background bio, and a contact section — all backed by to… |
| token-usage | observed | 1492015.00 | aab=1492015 probe=22524 total=1514539 tokens |
| tool-batching-efficiency | observed | 0.97 | 33 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.06 | 2/35 tool calls failed (6%): media-logo__generate_logo, str_replace_based_edit_tool |
| tool-parallelism | observed | 0.01 | Tool parallelism ratio: 1% |
| turn-duration | observed | 343242.00 | Total AAB duration: 343242ms across 2 turns (avg 171621ms) |
