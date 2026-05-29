## Eval results

- Scenario: `multipage-catalog`
- Trial: `12`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.90 | 4 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | The rendered HTML confirms all three major implicit feature areas are present: (1) Homepage has a hero with CTA linking to /shop, 4 featured product cards with images/names/prices, craft philosophy s… |
| intent-to-output-alignment | observed | 0.88 | The final HTML snapshot confirms all three pages exist with shared Header/Footer via RootLayout, a homepage with hero banner, featured products (4 cards with images/names/prices pulled via API), news… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.03 | TTFC=86083ms maxGap=119286ms total=656200ms chunks=62 turns=4 score=0.03 aabInit=75199ms aabTTFC=8754ms |
| output-quality | pass | 0.84 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.90 | 4 user turns |
| silent-hallucination | observed | 0.82 | The agent's claims are largely backed by observable evidence: (1) the final HTML snapshot confirms a shared Header/Footer rendered via a layout component (data-dev-file='/app/src/layouts/Website.tsx'… |
| token-usage | observed | 1571050.00 | aab=1571050 probe=95531 total=1666581 tokens |
| tool-batching-efficiency | observed | 0.96 | 52 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.02 | 1/53 tool calls failed (2%): fontTheme |
| tool-parallelism | observed | 0.12 | Tool parallelism ratio: 12% |
| turn-duration | observed | 631840.00 | Total AAB duration: 631840ms across 4 turns (avg 157960ms) |
