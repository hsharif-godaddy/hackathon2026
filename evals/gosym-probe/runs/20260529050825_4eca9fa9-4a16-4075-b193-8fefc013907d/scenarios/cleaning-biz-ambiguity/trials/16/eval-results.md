## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `16`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.85 | The rendered homepage contains a clear services section with three named services (Regular Cleaning, Deep Cleaning, Move-In/Move-Out), real contact info (503-555-0192 and sparkle@sparkleclean.com) in… |
| intent-to-output-alignment | observed | 0.95 | The site includes a clearly labeled services section (Regular Cleaning, Deep Cleaning, Move-In/Move-Out) in a staggered two-column layout, a contact page with a quote request form, and the user's rea… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=55657ms maxGap=105600ms total=490611ms chunks=62 turns=5 score=0.00 aabInit=51738ms aabTTFC=3917ms |
| output-quality | pass | 0.82 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.92 | The agent claimed to update contact details to (503) 555-0192 and sparkle@sparkleclean.com everywhere, and the final DOM confirms '(503) 555-0192 — Free quotes, no obligation' in the header top bar. … |
| token-usage | observed | 1513178.00 | aab=1513178 probe=54013 total=1567191 tokens |
| tool-batching-efficiency | observed | 0.91 | 34 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.03 | 1/35 tool calls failed (3%): str_replace_based_edit_tool |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 471598.00 | Total AAB duration: 471598ms across 6 turns (avg 78600ms) |
