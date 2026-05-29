## Eval results

- Scenario: `multipage-catalog`
- Trial: `8`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered HTML confirms all major implied features are present: hero banner with dual CTAs (Shop Now / Our Story), featured products section pulling from the API with images/names/prices/category … |
| intent-to-output-alignment | observed | 0.85 | The final HTML snapshot confirms all three required pages exist with shared Header/Footer via RootLayout (data-dev-file shows Header.tsx and Website.tsx wrapping all content), homepage has hero banne… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.12 | TTFC=73704ms maxGap=103300ms total=530750ms chunks=67 turns=4 score=0.12 aabInit=67515ms aabTTFC=3187ms |
| output-quality | pass | 0.78 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.72 | The agent's core claims are well-supported: the shared RootLayout wrapping all pages is visible in the DOM (header/footer render consistently, data-dev-file pointing to Website.tsx/Header.tsx/Footer.… |
| token-usage | observed | 1427346.00 | aab=1427346 probe=93740 total=1521086 tokens |
| tool-batching-efficiency | observed | 0.98 | 47 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 47 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 513819.00 | Total AAB duration: 513819ms across 4 turns (avg 128455ms) |
