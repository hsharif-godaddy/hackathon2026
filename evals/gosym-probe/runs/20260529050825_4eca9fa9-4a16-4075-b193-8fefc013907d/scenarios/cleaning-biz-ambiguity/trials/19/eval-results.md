## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `19`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.86 | 6 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered HTML confirms a services section with three named services (Regular Cleaning, Deep Clean, Move-In/Move-Out), a visible phone number (555) 123-4567 as a clickable tel: link in the hero, a… |
| intent-to-output-alignment | observed | 0.92 | The site fully satisfies the scenario goals: a services section with three photo-backed cleaning service cards (Regular Cleaning, Deep Clean, Move-In/Move-Out) is present in the DOM, and contact info… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.28 | TTFC=79112ms maxGap=92999ms total=461782ms chunks=46 turns=5 score=0.28 aabInit=60024ms aabTTFC=19054ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.86 | 6 user turns |
| silent-hallucination | observed | 0.85 | Agent claimed to build a homepage with services section, contact info (phone number placeholder), and a contact page with form — all are confirmed in the final HTML snapshot showing three service car… |
| token-usage | observed | 1378293.00 | aab=1378293 probe=60799 total=1439092 tokens |
| tool-batching-efficiency | observed | 0.94 | 32 successful calls across 3 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 32 tool call(s) |
| tool-parallelism | observed | 0.05 | Tool parallelism ratio: 5% |
| turn-duration | observed | 446206.00 | Total AAB duration: 446206ms across 6 turns (avg 74368ms) |
