## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `1`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.88 | 5 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.85 | The rendered HTML confirms a services section with four room-specific cleaning cards (Kitchen Deep Clean, Bathroom Refresh, Bedroom, Living Room), each with included items listed. Contact information… |
| intent-to-output-alignment | observed | 0.92 | The site clearly includes a services section (Kitchen Deep Clean, Bathroom Refresh, Bedroom, Living Room cards with detailed inclusions), contact information with phone number (555) 987-6543, email, … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.23 | TTFC=62669ms maxGap=110084ms total=442422ms chunks=65 turns=4 score=0.23 aabInit=46710ms aabTTFC=15926ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.88 | 5 user turns |
| silent-hallucination | observed | 0.82 | Agent claims are well-supported: services section with room-specific cards (kitchen, bathroom, bedroom, living room) is confirmed in the DOM; contact info with phone (555) 987-6543, email, and hours … |
| token-usage | observed | 1364340.00 | aab=1364340 probe=34955 total=1399295 tokens |
| tool-batching-efficiency | observed | 0.90 | 32 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 32 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 428318.00 | Total AAB duration: 428318ms across 5 turns (avg 85664ms) |
