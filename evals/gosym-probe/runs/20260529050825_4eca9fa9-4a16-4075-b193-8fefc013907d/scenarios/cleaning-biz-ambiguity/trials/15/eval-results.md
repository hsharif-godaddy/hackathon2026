## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `15`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | The rendered HTML confirms a full services section (Regular Cleaning, Deep Clean, Move-In/Move-Out with descriptions and feature lists), real contact info (555-867-5309 and cleanwithcare@gmail.com) p… |
| intent-to-output-alignment | observed | 0.92 | The site clearly meets the scenario goals: a services section with three cleaning services (Regular Cleaning, Deep Clean, Move-In/Move-Out) is present in the HTML, and the user's real contact info (5… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.40 | TTFC=63181ms maxGap=85890ms total=375230ms chunks=25 turns=5 score=0.40 aabInit=46317ms aabTTFC=16831ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.85 | The agent claimed the real phone number (555) 867-5309 and email cleanwithcare@gmail.com are shown 'everywhere' on the site. The final HTML confirms (555) 867-5309 appears in the header CTA button (h… |
| token-usage | observed | 1153445.00 | aab=1153445 probe=43812 total=1197257 tokens |
| tool-batching-efficiency | observed | 0.93 | 28 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 28 tool call(s) |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 341369.00 | Total AAB duration: 341369ms across 6 turns (avg 56895ms) |
