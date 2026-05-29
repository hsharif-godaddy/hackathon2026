## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `13`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.77 | 9 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | The rendered site includes a services section with 4 cleaning services and photos, real contact details (phone (612) 555-0187 and email jen@jenscleaning.com) in multiple locations including a dedicat… |
| intent-to-output-alignment | observed | 0.92 | The final HTML clearly shows a services section with 4 cleaning services (Regular, Deep Clean, Move-In/Out, Home Office), contact information prominently displayed including the user's real phone num… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.37 | TTFC=5235ms maxGap=85381ms total=534092ms chunks=99 turns=8 score=0.37 aabInit=1635ms aabTTFC=3566ms aabWorstGap=64159ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.77 | 9 user turns |
| silent-hallucination | observed | 0.82 | Agent claims about contact details (phone (612) 555-0187, email jen@jenscleaning.com), services section, and business name 'Jen's Cleaning' are all confirmed in the final HTML snapshot. The agent acc… |
| token-usage | observed | 1639869.00 | aab=1639869 probe=82590 total=1722459 tokens |
| tool-batching-efficiency | observed | 0.88 | 35 successful calls across 5 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 35 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 512241.00 | Total AAB duration: 512241ms across 9 turns (avg 56916ms) |
