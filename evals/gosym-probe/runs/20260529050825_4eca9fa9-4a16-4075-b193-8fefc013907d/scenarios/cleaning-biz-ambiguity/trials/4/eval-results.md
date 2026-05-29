## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `4`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.88 | 5 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.88 | The rendered homepage includes a prominent services section (Regular Cleaning, Deep Cleaning, Move-In/Move-Out), phone number in three locations (top announcement bar, hero CTA button, footer contact… |
| intent-to-output-alignment | observed | 0.92 | The final site clearly matches the user's intent: it includes a services section with Regular Cleaning, Deep Cleaning, and Move-In/Move-Out cards, plus phone number (555) 123-4567 prominently in thre… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.12 | TTFC=63640ms maxGap=78824ms total=445901ms chunks=52 turns=4 score=0.12 aabInit=45786ms aabTTFC=17852ms |
| output-quality | pass | 0.82 | Composite of 8/9 sub-evaluators |
| prompt-efficiency | observed | 0.88 | 5 user turns |
| silent-hallucination | observed | 0.82 | The agent's claims are well-supported by observable artifacts: the HTML snapshot confirms a sticky phone number bar ('(555) 123-4567'), a clickable tel: link in the hero, a bento-style services secti… |
| token-usage | observed | 1441641.00 | aab=1441641 probe=38929 total=1480570 tokens |
| tool-batching-efficiency | observed | 0.90 | 31 successful calls across 4 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 31 tool call(s) |
| tool-parallelism | observed | 0.06 | Tool parallelism ratio: 6% |
| turn-duration | observed | 428888.00 | Total AAB duration: 428888ms across 5 turns (avg 85778ms) |
