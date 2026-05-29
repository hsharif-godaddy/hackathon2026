## Eval results

- Scenario: `multipage-catalog`
- Trial: `16`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | Homepage has hero with dual CTAs, featured products grid with names/prices/categories, category navigation grid, and shared nav/footer. Newsletter signup was built per conversation. Missing contact i… |
| intent-to-output-alignment | observed | 0.88 | All three pages built with React Router and correct content (homepage hero+featured products+newsletter, catalog with category filters, about with team profiles). Product data extracted to `src/lib/p… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.11 | TTFC=50899ms maxGap=108658ms total=487691ms chunks=60 turns=4 score=0.11 aabInit=48277ms aabTTFC=2589ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.72 | The agent successfully created a multi-page site with shared Header/Footer via a RootLayout/Website.tsx layout component (confirmed in final HTML with data-dev-file references to Header.tsx and Websi… |
| token-usage | observed | 1815701.00 | aab=1815701 probe=86093 total=1901794 tokens |
| tool-batching-efficiency | observed | 0.96 | 48 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 48 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 474192.00 | Total AAB duration: 474192ms across 4 turns (avg 118548ms) |
