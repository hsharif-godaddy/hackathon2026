## Eval results

- Scenario: `multipage-catalog`
- Trial: `13`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.75 | The homepage renders hero, newsletter signup, category quick-links, and a 'Featured Pieces' section structure, but the featured product cards are still in a loading/skeleton state (4 animated pulse p… |
| intent-to-output-alignment | observed | 0.82 | The site delivers all three required pages (homepage with hero, featured products, newsletter; catalog with category filters; about page), shared header/footer in a layout component (Website.tsx wrap… |
| jtbd-completion | partial | 0.50 | LLM judge verdict: partial |
| latency | observed | 0.42 | TTFC=52913ms maxGap=121824ms total=482358ms chunks=82 turns=4 score=0.42 aabInit=50402ms aabTTFC=2479ms |
| output-quality | pass | 0.78 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.72 | The agent correctly built a service module (products-service.ts), shared layout (RootLayout/Website.tsx wrapping Header and Footer), and API endpoint — all supported by tool calls and DOM evidence sh… |
| token-usage | observed | 1840720.00 | aab=1840720 probe=97329 total=1938049 tokens |
| tool-batching-efficiency | observed | 0.98 | 53 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 53 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 451747.00 | Total AAB duration: 451747ms across 4 turns (avg 112937ms) |
