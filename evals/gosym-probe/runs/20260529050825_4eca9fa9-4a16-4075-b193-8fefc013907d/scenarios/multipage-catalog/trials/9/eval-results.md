## Eval results

- Scenario: `multipage-catalog`
- Trial: `9`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.75 | The homepage renders a full hero with dual CTAs, featured products grid (4 products with images/names/prices), and a newsletter signup section — all explicitly requested features. The shared header a… |
| intent-to-output-alignment | observed | 0.82 | All three pages (homepage, products, about) are present with correct structure: hero+featured products+newsletter on home, category filters+product grid on /products loaded via React Router loader fr… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.07 | TTFC=63413ms maxGap=117305ms total=624094ms chunks=78 turns=3 score=0.07 aabInit=58643ms aabTTFC=4739ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.72 | The agent's claims about multi-page setup, shared layout via RootLayout/App.tsx wrapping all routes, the products service module, and the API endpoint are largely backed by tool calls (colorScheme, f… |
| token-usage | observed | 1974102.00 | aab=1974102 probe=54025 total=2028127 tokens |
| tool-batching-efficiency | observed | 0.96 | 58 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 58 tool call(s) |
| tool-parallelism | observed | 0.08 | Tool parallelism ratio: 8% |
| turn-duration | observed | 604646.00 | Total AAB duration: 604646ms across 3 turns (avg 201549ms) |
