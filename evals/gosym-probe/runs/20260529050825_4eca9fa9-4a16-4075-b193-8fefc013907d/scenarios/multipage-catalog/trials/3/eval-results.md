## Eval results

- Scenario: `multipage-catalog`
- Trial: `3`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.75 | Homepage, catalog with category filters, about page with team profiles, and shared header/footer are all present and rendered. However, a runtime React hook error crashes client-side rendering of the… |
| intent-to-output-alignment | observed | 0.82 | All three goals are substantially met: (1) multi-page site with homepage/shop/about confirmed in HTML and routes; (2) dedicated products-service.ts module with fetchProducts/fetchFeaturedProducts cre… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.05 | TTFC=64896ms maxGap=117094ms total=513805ms chunks=98 turns=3 score=0.05 aabInit=53032ms aabTTFC=11831ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.45 | The agent's claims about RootLayout wrapping all pages are supported by the HTML snapshot showing Header.tsx and Website.tsx as wrapper components. However, the agent explicitly stated 'Everything is… |
| token-usage | observed | 1966614.00 | aab=1966614 probe=55673 total=2022287 tokens |
| tool-batching-efficiency | observed | 0.96 | 52 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 52 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 502165.00 | Total AAB duration: 502165ms across 3 turns (avg 167388ms) |
