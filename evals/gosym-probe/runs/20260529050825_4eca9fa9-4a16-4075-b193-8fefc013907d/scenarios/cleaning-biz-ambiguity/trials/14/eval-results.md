## Eval results

- Scenario: `cleaning-biz-ambiguity`
- Trial: `14`

| Evaluator | Verdict | Score | Reason |
|----------|---------|-------|--------|
| agent-steps | observed | 0.77 | 9 agent steps |
| bug-hit-rate | pass | 1.00 | No unrecovered errors |
| implicit-feature-gap | observed | 0.92 | The site includes a full services section (Regular, Deep, Move-In/Out with descriptions and pricing on /services), real contact information updated to (412) 555-9876 and cleanwithcare@gmail.com with … |
| intent-to-output-alignment | observed | 0.92 | The site includes a clear services section (Regular Cleaning, Deep Cleaning, Move-In/Out) with pricing and descriptions, a dedicated contact page with the user's real phone number (412) 555-9876 and … |
| jtbd-completion | pass | 1.00 | LLM judge verdict: pass |
| latency | observed | 0.00 | TTFC=62710ms maxGap=52002ms total=729808ms chunks=107 turns=8 score=0.00 aabInit=46534ms aabTTFC=16085ms aabWorstGap=48115ms |
| output-quality | pass | 0.83 | Composite of 9/9 sub-evaluators |
| prompt-efficiency | observed | 0.77 | 9 user turns |
| silent-hallucination | observed | 0.82 | Agent claims are largely backed by observable evidence: the final HTML snapshot confirms a services section (Regular Cleaning, Deep Cleaning, Move-In/Out), navigation links to /services, /contact, /a… |
| token-usage | observed | 4248776.00 | aab=4248776 probe=101867 total=4350643 tokens |
| tool-batching-efficiency | observed | 0.89 | 67 successful calls across 8 productive turns |
| tool-failure-rate | observed | 0.06 | 4/71 tool calls failed (6%): media-logo__generate_logo, str_replace_based_edit_tool |
| tool-parallelism | observed | 0.01 | Tool parallelism ratio: 1% |
| turn-duration | observed | 704747.00 | Total AAB duration: 704747ms across 9 turns (avg 78305ms) |
