## Eval results

- Scenario: `simple-portfolio`
- Trial: `4`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.92 | 3 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | All three required sections are present and content-rich: hero with 'Marcus Webb', UX/UI Designer tagline, and a CTA; about with three paragraphs of background bio; contact with a mailto email link (… |
| intent-to-output-alignment | observed | 0.92 | The final HTML snapshot confirms all three required sections are present: a hero section with 'Marcus Webb' displayed prominently as an oversized heading and the tagline 'Crafting digital experiences… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=60392ms maxGap=73217ms total=254294ms chunks=12 turns=2 score=0.00 aabInit=52934ms aabTTFC=7426ms |
| output-quality | pass | 0.81 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.92 | 3 user turns |
| silent-hallucination | observed | 0.82 | The final DOM confirms all three required sections (hero with 'Marcus Webb' + tagline, about with bio paragraphs, contact with mailto:hello@marcuswebb.com and LinkedIn/Dribbble/Twitter icons) are pre… |
| token-usage | observed | 692769.00 | aab=692769 probe=15843 total=708612 tokens |
| tool-batching-efficiency | observed | 0.95 | 22 successful calls across 2 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 22 tool call(s) |
| tool-parallelism | observed | 0.03 | Tool parallelism ratio: 3% |
| turn-duration | observed | 248002.00 | Total AAB duration: 248002ms across 3 turns (avg 82667ms) |
