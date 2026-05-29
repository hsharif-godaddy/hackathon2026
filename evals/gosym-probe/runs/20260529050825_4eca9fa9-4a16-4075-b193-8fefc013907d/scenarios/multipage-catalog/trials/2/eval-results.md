## Eval results

- Scenario: `multipage-catalog`
- Trial: `2`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.85 | Homepage has hero, featured products with prices/images, values strip, and newsletter signup; product catalog has category filters and product grid; about page has story, mission, and team profiles; … |
| intent-to-output-alignment | observed | 0.90 | The final HTML snapshot confirms all three required pages exist with shared Header/Footer from RootLayout, the homepage has hero banner with 'Shop Now'/'Our Story' CTAs, featured products section (4 … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.35 | TTFC=53375ms maxGap=79313ms total=471646ms chunks=135 turns=4 score=0.35 aabInit=51040ms aabTTFC=2302ms |
| output-quality | pass | 0.85 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.82 | The agent's claims about service layer extraction (products-api.ts), shared RootLayout wrapping all pages, and API-driven product fetching are all substantiated by tool calls and the rendered DOM sho… |
| token-usage | observed | 1959261.00 | aab=1959261 probe=93624 total=2052885 tokens |
| tool-batching-efficiency | observed | 0.97 | 61 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 61 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 456136.00 | Total AAB duration: 456136ms across 4 turns (avg 114034ms) |
