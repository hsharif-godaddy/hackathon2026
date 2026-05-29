## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `18`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.88 | 5 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.82 | Services section with three cleaning types (Regular, Deep, Move-In/Out) is fully rendered; phone number (512) 555-0198 appears as a tap-to-call link in the header and is confirmed in CTA/footer per c… |
| intent-to-output-alignment | observed | 0.95 | The final HTML confirms a fully built site for 'Shine Bright Cleaning' with (1) a services section featuring Regular Cleaning, Deep Cleaning, and Move-In/Move-Out Cleaning in a staggered photo/text l… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.01 | TTFC=68968ms maxGap=114348ms total=421183ms chunks=36 turns=4 score=0.01 aabInit=58145ms aabTTFC=10790ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.88 | 5 user turns |
| silent-hallucination | observed | 0.90 | The agent claimed the phone number (512) 555-0198 appears in the header, CTA section, and footer — the final HTML DOM confirms `href='tel:+15125550198'` and the visible text '(512) 555-0198' in the h… |
| token-usage | observed | 1240737.00 | aab=1240737 probe=40530 total=1281267 tokens |
| tool-batching-efficiency | observed | 0.94 | 32 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.03 | 1/33 tool calls failed (3%): str_replace_based_edit_tool |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 404079.00 | Total AAB duration: 404079ms across 5 turns (avg 80816ms) |
