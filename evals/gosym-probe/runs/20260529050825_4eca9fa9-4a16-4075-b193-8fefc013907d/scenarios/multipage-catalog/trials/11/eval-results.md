## Eval results

- Scenario: `multipage-catalog`
- Trial: `11`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered HTML confirms all major implied features are present: homepage has a hero banner with CTA ('Shop Now'), featured products section ('Handpicked for You') with 4 product cards showing imag… |
| intent-to-output-alignment | observed | 0.95 | All three required pages (homepage with hero/featured products/newsletter, product catalog with category filters, about page) are built and visible in the DOM. The agent explicitly confirmed and the … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.07 | TTFC=62242ms maxGap=131237ms total=686589ms chunks=56 turns=4 score=0.07 aabInit=58118ms aabTTFC=4092ms |
| output-quality | pass | 0.85 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.88 | The agent's claims are well-supported by observable evidence: (1) The HTML confirms a single shared layout wrapper (Website.tsx + Header.tsx/Footer.tsx) renders on all pages, consistent with the clai… |
| token-usage | observed | 2200510.00 | aab=2200510 probe=101006 total=2301516 tokens |
| tool-batching-efficiency | observed | 0.96 | 54 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 54 tool call(s) |
| tool-parallelism | observed | 0.07 | Tool parallelism ratio: 7% |
| turn-duration | observed | 667166.00 | Total AAB duration: 667166ms across 4 turns (avg 166792ms) |
