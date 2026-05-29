## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `3`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered site includes a clear services section (Regular Cleaning, Deep Cleaning, Move-In/Move-Out with descriptions and feature lists), contact information (phone number (555) 867-5309 visible i… |
| intent-to-output-alignment | observed | 0.95 | The site clearly matches user intent: it's a residential cleaning business site for 'Spotless Home Cleaning' with a services section (Regular Cleaning, Deep Cleaning, Move-In/Move-Out) visible in the… |
| jtbd-completion | partial | 0.50 | LLM judge verdict: partial |
| latency | observed | 0.32 | TTFC=73914ms maxGap=98605ms total=425407ms chunks=49 turns=5 score=0.32 aabInit=54673ms aabTTFC=19210ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.82 | The agent claimed the phone number (555) 867-5309 appears in the header, footer, and contact page — the final HTML snapshot confirms '(555) 867-5309' is present in the header top bar, supported by th… |
| token-usage | observed | 1110587.00 | aab=1110587 probe=50773 total=1161360 tokens |
| tool-batching-efficiency | observed | 0.88 | 27 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.04 | 1/28 tool calls failed (4%): media-logo__generate_logo |
| tool-parallelism | observed | 0.07 | Tool parallelism ratio: 7% |
| turn-duration | observed | 410344.00 | Total AAB duration: 410344ms across 6 turns (avg 68391ms) |
