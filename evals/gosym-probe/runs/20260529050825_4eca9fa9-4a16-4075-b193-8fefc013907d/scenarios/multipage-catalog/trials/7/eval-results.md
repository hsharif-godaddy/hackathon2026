## Eval results

- Scenario: `multipage-catalog`
- Trial: `7`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered homepage clearly shows a hero banner with CTAs ('Shop Now', 'Our Story'), a Featured Pieces section with 4 product cards (images, names, category badges, prices), category navigation lin… |
| intent-to-output-alignment | observed | 0.82 | The final snapshot confirms all three pages exist (homepage with hero, featured products, newsletter; product catalog with category filters; about page), shared Header/Footer via RootLayout wraps all… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.09 | TTFC=55140ms maxGap=103562ms total=462017ms chunks=70 turns=3 score=0.09 aabInit=52520ms aabTTFC=2590ms |
| output-quality | pass | 0.84 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.72 | The agent's claims about API-driven product loading and shared RootLayout are structurally credible and partially evidenced: tool calls show a products API endpoint was built, Header/Footer component… |
| token-usage | observed | 1385878.00 | aab=1385878 probe=61110 total=1446988 tokens |
| tool-batching-efficiency | observed | 0.98 | 52 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 52 tool call(s) |
| tool-parallelism | observed | 0.08 | Tool parallelism ratio: 8% |
| turn-duration | observed | 450493.00 | Total AAB duration: 450493ms across 3 turns (avg 150164ms) |
