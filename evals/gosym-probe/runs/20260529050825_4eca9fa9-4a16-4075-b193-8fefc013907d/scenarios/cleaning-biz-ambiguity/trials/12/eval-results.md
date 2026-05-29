## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `12`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered homepage clearly shows a services section with three distinct offerings (Regular Cleaning, Deep Cleaning, Move-In/Move-Out) with descriptions and checklists, a phone number (555) 123-456… |
| intent-to-output-alignment | observed | 0.92 | The site includes a services section (Regular Cleaning, Deep Cleaning, Move-In/Move-Out with descriptions and checklists), contact information prominently displayed (phone number in header, hero, and… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.17 | TTFC=61136ms maxGap=95923ms total=579412ms chunks=52 turns=5 score=0.17 aabInit=46903ms aabTTFC=14201ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.82 | The agent claimed to build a homepage with services section, a services/pricing page, and a contact page — all backed by tool calls (str_replace_based_edit_tool, media fetches, colorScheme, fontTheme… |
| token-usage | observed | 3095559.00 | aab=3095559 probe=57081 total=3152640 tokens |
| tool-batching-efficiency | observed | 0.91 | 56 successful calls across 6 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 56 tool call(s) |
| tool-parallelism | observed | 0.02 | Tool parallelism ratio: 2% |
| turn-duration | observed | 566039.00 | Total AAB duration: 566039ms across 6 turns (avg 94340ms) |
