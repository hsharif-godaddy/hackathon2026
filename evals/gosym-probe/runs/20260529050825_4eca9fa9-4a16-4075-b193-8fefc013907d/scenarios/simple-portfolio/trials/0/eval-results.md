## Eval results

- Scenario: `simple-portfolio`
- Trial: `0`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.90 | Hero (name, tagline, CTAs), About (bio prose, stat cards), and Contact (email link, social icons per agent description confirmed by user) are all rendered. A bonus Projects section was added. Minor d… |
| intent-to-output-alignment | observed | 0.95 | The final HTML snapshot confirms all three required sections are present and populated: a Hero section with 'Jordan Lee' and tagline 'Full-stack developer & creator', an About section with bio prose … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.46 | TTFC=46213ms maxGap=58949ms total=316634ms chunks=59 turns=3 score=0.46 aabInit=44219ms aabTTFC=1962ms |
| output-quality | pass | 0.80 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.85 | The final HTML confirms all three required sections are present: a hero with 'Jordan Lee' and tagline, an about section with bio and stat cards, and a contact section with email link and social icons… |
| token-usage | observed | 1070806.00 | aab=1070806 probe=26587 total=1097393 tokens |
| tool-batching-efficiency | observed | 0.92 | 27 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 27 tool call(s) |
| tool-parallelism | observed | 0.10 | Tool parallelism ratio: 10% |
| turn-duration | observed | 306260.00 | Total AAB duration: 306260ms across 4 turns (avg 76565ms) |
