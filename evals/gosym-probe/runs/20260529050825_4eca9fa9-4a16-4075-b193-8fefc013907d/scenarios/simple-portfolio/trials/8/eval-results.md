## Eval results

- Scenario: `simple-portfolio`
- Trial: `8`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.93 | 2 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.95 | All three required sections are present and fully rendered in the DOM: hero with name 'Alex Morgan' and tagline, about section with background copy and skills tags, and contact section with a mailto … |
| intent-to-output-alignment | observed | 0.95 | The final HTML snapshot confirms all three required sections are present: a hero section with name 'Alex Morgan' and tagline, an 'About Me' section with background text and skill tags, and a 'Contact… |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=50287ms maxGap=39169ms total=194642ms chunks=32 turns=2 score=0.00 aabInit=47559ms aabTTFC=2695ms |
| output-quality | pass | 0.86 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.93 | 2 user turns |
| silent-hallucination | observed | 0.85 | All three claimed sections (hero with name/tagline, about with background, contact with email link and social icons) are directly observable in the final HTML snapshot, matching the agent's stated de… |
| token-usage | observed | 623470.00 | aab=623470 probe=13593 total=637063 tokens |
| tool-batching-efficiency | observed | 1.00 | 20 successful calls across 1 productive turns |
| tool-failure-rate | observed | 0.00 | No tool failures across 20 tool call(s) |
| tool-parallelism | observed | 0.04 | Tool parallelism ratio: 4% |
| turn-duration | observed | 190207.00 | Total AAB duration: 190207ms across 2 turns (avg 95104ms) |
