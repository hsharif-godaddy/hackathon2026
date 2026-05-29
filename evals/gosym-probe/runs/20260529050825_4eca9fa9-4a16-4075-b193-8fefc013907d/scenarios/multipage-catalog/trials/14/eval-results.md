## Eval results

- Scenario: `multipage-catalog`
- Trial: `14`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.85 | All requested implicit features are present: hero with CTA, featured products with images/names/prices, newsletter signup, category filters (Pottery/Textiles/Woodwork/Jewelry), team profiles, mission… |
| intent-to-output-alignment | observed | 0.88 | All three required pages (homepage, products, about) are built with the correct content: hero banner with 'Handcrafted with Heart' headline and CTA, featured products grid, newsletter signup, categor… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.30 | TTFC=54681ms maxGap=112871ms total=531413ms chunks=136 turns=4 score=0.30 aabInit=52503ms aabTTFC=2145ms |
| output-quality | pass | 0.84 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.72 | The agent's core claims are well-supported: tool calls confirm a products API endpoint was created (GET /api/products with category filtering), a products-service.ts module was extracted for data-lay… |
| token-usage | observed | 2545290.00 | aab=2545290 probe=100615 total=2645905 tokens |
| tool-batching-efficiency | observed | 0.98 | 60 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.03 | 2/62 tool calls failed (3%): media-logo__generate_logo, str_replace_based_edit_tool |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 498984.00 | Total AAB duration: 498984ms across 4 turns (avg 124746ms) |
