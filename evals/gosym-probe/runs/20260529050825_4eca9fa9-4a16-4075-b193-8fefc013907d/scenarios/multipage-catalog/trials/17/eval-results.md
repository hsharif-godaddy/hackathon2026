## Eval results

- Scenario: `multipage-catalog`
- Trial: `17`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered HTML confirms all major implied features are present: homepage with hero banner (full-bleed image, headline, CTA), featured products section with product cards (images, names, prices), n… |
| intent-to-output-alignment | observed | 0.88 | The final site HTML confirms all three pages exist with shared Header/Footer via a RootLayout layout component (data-dev-file='/app/src/layouts/Website.tsx' and '/app/src/layouts/parts/Header.tsx'), … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.30 | TTFC=55604ms maxGap=81754ms total=455029ms chunks=89 turns=3 score=0.30 aabInit=52618ms aabTTFC=2785ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.72 | The agent's claims about API-driven products and a shared layout component (RootLayout/Website.tsx wrapping Header+Footer) are strongly supported by the HTML evidence — `data-dev-file` attributes sho… |
| token-usage | observed | 1474820.00 | aab=1474820 probe=68563 total=1543383 tokens |
| tool-batching-efficiency | observed | 1.00 | 52 successful calls across 1 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 52 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 442401.00 | Total AAB duration: 442401ms across 3 turns (avg 147467ms) |
