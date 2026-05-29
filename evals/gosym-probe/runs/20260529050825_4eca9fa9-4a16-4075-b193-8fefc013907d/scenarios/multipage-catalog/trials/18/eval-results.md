## Eval results

- Scenario: `multipage-catalog`
- Trial: `18`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered HTML confirms all major implicit features are present: hero with CTA, featured products section with images/prices/category badges, newsletter signup with email input, category strip (Sh… |
| intent-to-output-alignment | observed | 0.85 | The HTML snapshot confirms a homepage with hero banner, featured products (4 product cards with images, names, prices), newsletter signup, and category strip. The agent confirmed a shared RootLayout … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.33 | TTFC=71806ms maxGap=87041ms total=429739ms chunks=103 turns=3 score=0.33 aabInit=58840ms aabTTFC=12921ms |
| output-quality | pass | 0.84 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.82 | The agent's claims about the API endpoint (src/server/api/products/GET.ts), route loader pattern, shared RootLayout with Header/Footer wrapping all routes via Outlet, and ProductCard as a purely pres… |
| token-usage | observed | 1377952.00 | aab=1377952 probe=76157 total=1454109 tokens |
| tool-batching-efficiency | observed | 0.96 | 51 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.02 | 1/52 tool calls failed (2%): media |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 419354.00 | Total AAB duration: 419354ms across 3 turns (avg 139785ms) |
