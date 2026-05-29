## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `8`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.80 | 8 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | Services section with three cleaning types is fully rendered; phone number (555-867-5309) appears as a clickable tel: link in the header and hero CTA; contact form at /contact collects name, email, p… |
| intent-to-output-alignment | observed | 0.92 | The site includes a clear services section (Regular Cleaning, Deep Cleaning, Move-Out Cleaning inferred from HTML), contact information with phone number (555) 867-5309 updated everywhere per user re… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.23 | TTFC=54326ms maxGap=80613ms total=558350ms chunks=31 turns=6 score=0.23 aabInit=49302ms aabTTFC=3524ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.80 | 8 user turns |
| silent-hallucination | observed | 0.82 | The agent claimed phone number (555) 867-5309 is updated 'everywhere — the header, footer, homepage, and contact page,' and the final HTML confirms tel:+15558675309 appears in the header CTA and hero… |
| token-usage | observed | 1907121.00 | aab=1907121 probe=97152 total=2004273 tokens |
| tool-batching-efficiency | observed | 0.89 | 39 successful calls across 5 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 39 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 528018.00 | Total AAB duration: 528018ms across 8 turns (avg 66002ms) |
