## Eval results

- Scenario: `multipage-catalog`
- Trial: `5`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered homepage shows all three expected implicit features: a hero with dual CTAs (Shop Now → /products, Our Story → /about), a Featured Pieces section with product cards showing images/names/p… |
| intent-to-output-alignment | observed | 0.88 | The final HTML snapshot confirms all three core requirements are substantially met: (1) the homepage shows hero banner with dual CTAs (Shop Now → /products, Our Story → /about), featured products sec… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.19 | TTFC=62183ms maxGap=109109ms total=514637ms chunks=69 turns=4 score=0.19 aabInit=59312ms aabTTFC=2839ms |
| output-quality | pass | 0.80 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.82 | The agent's claims are well-supported by observable evidence: (1) A dedicated `src/lib/products-service.ts` module was created and the agent confirmed pages import from it rather than hardcoding data… |
| token-usage | observed | 1804116.00 | aab=1804116 probe=87853 total=1891969 tokens |
| tool-batching-efficiency | observed | 0.97 | 59 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 59 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 502112.00 | Total AAB duration: 502112ms across 4 turns (avg 125528ms) |
