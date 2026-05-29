## Eval results

- Scenario: `multipage-catalog`
- Trial: `6`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered HTML confirms homepage hero with dual CTAs, featured products section with 4 API-loaded product cards (names, prices, categories all present), category showcase tiles linking to /shop?ca… |
| intent-to-output-alignment | observed | 0.85 | The site clearly delivers all three required pages (homepage with hero/featured products/newsletter, shop with category filters, about with team profiles), a shared header/footer via a reusable layou… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.12 | TTFC=72104ms maxGap=100869ms total=518519ms chunks=108 turns=4 score=0.12 aabInit=62217ms aabTTFC=9884ms |
| output-quality | pass | 0.85 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.82 | The agent's claims are largely backed by evidence: the HTML snapshot confirms product data (names, prices, categories) is rendering from API-sourced data via useLoaderData(), the Header/Footer compon… |
| token-usage | observed | 1459060.00 | aab=1459060 probe=121151 total=1580211 tokens |
| tool-batching-efficiency | observed | 0.97 | 60 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.02 | 1/61 tool calls failed (2%): media |
| tool-parallelism | observed | 0.07 | Tool parallelism ratio: 7% |
| turn-duration | observed | 500844.00 | Total AAB duration: 500844ms across 4 turns (avg 125211ms) |
