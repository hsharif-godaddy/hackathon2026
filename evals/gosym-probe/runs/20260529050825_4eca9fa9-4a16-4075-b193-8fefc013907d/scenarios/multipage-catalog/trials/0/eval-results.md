## Eval results

- Scenario: `multipage-catalog`
- Trial: `0`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.72 | The homepage renders with hero banner, featured products grid (4 products with images/names/prices), category browsing tiles, and a newsletter signup section visible in the body HTML. Navigation head… |
| intent-to-output-alignment | observed | 0.85 | The final site clearly delivers all three required pages (homepage with hero/featured products/newsletter, product catalog with category filters, about page), a shared layout via RootLayout wrapping … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.27 | TTFC=55567ms maxGap=103170ms total=483393ms chunks=88 turns=4 score=0.27 aabInit=53147ms aabTTFC=2350ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.72 | The agent's claims about the service module (src/services/products.ts), shared RootLayout, and API endpoint are broadly consistent with observable artifacts — the HTML confirms Header/Footer render f… |
| token-usage | observed | 1991155.00 | aab=1991155 probe=114729 total=2105884 tokens |
| tool-batching-efficiency | observed | 0.96 | 57 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.02 | 1/58 tool calls failed (2%): media-logo__generate_logo |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 470404.00 | Total AAB duration: 470404ms across 4 turns (avg 117601ms) |
