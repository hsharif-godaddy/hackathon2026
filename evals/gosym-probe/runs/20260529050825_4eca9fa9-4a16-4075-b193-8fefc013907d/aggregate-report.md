# Eval Run: 4eca9fa9-4a16-4075-b193-8fefc013907d
**Generated:** 2026-05-29T15:35:19.939Z
**Git:** `f0202b9` on `main`
**Mode:** graduation | **Stability:** high (20 trials) × 3

---

## Suite Summary

- Scenarios: **3**
- Trials: **60**

### Evaluator rollup (across scenarios)

| Evaluator | pass | partial | fail | unknown | pass rate |
|----------|------|---------|------|---------|-----------|
| bug-hit-rate | 60 | 0 | 0 | 0 | 100% |
| implicit-feature-gap | 0 | 0 | 0 | 5 | 0% |
| intent-to-output-alignment | 0 | 0 | 0 | 5 | 0% |
| jtbd-completion | 55 | 4 | 0 | 1 | 92% |
| output-quality | 55 | 0 | 0 | 5 | 92% |
| silent-hallucination | 0 | 0 | 0 | 5 | 0% |

| Field | Value |
|-------|-------|
| Scenarios | 3 |
| Total Trials | 60 |
| Total Duration | 7h 47m 28s |

---

## Gated Scenarios

> Results in this section gate the PR.

*(none)*

## Informational Scenarios

> Results in this section are informational only.

| Scenario | Evaluator | pass@k | pass^k | Pass Rate | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | T18 | T19 | T20 |
|----------|-----------|--------|--------|-----------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| simple-portfolio | bug-hit-rate | ✓ | ✓ | 20/20 (100%) | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| simple-portfolio | tool-failure-rate | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | prompt-efficiency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | jtbd-completion | ✓ | ✓ | 20/20 (100%) | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| simple-portfolio | output-quality | — | — | — | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| simple-portfolio | agent-steps | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | latency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | tool-parallelism | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | tool-batching-efficiency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | turn-duration | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | token-usage | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | intent-to-output-alignment | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | implicit-feature-gap | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| simple-portfolio | silent-hallucination | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | bug-hit-rate | ✓ | ✓ | 20/20 (100%) | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| multipage-catalog | tool-failure-rate | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | prompt-efficiency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | jtbd-completion | ✓ | ✗ | 18/20 (90%) | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | partial | pass | pass | pass | pass | pass | ⚠️ unknown |
| multipage-catalog | output-quality | — | — | — | pass | ⚠️ unknown | pass | pass | pass | pass | pass | pass | pass | pass | ⚠️ unknown | pass | pass | pass | pass | ⚠️ unknown | pass | pass | pass | ⚠️ unknown |
| multipage-catalog | agent-steps | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | latency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | tool-parallelism | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | tool-batching-efficiency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | turn-duration | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | token-usage | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| multipage-catalog | intent-to-output-alignment | — | — | — | observed | ⚠️ unknown | observed | observed | observed | observed | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | ⚠️ unknown |
| multipage-catalog | implicit-feature-gap | — | — | — | observed | ⚠️ unknown | observed | observed | observed | observed | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | ⚠️ unknown |
| multipage-catalog | silent-hallucination | — | — | — | observed | ⚠️ unknown | observed | observed | observed | observed | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | ⚠️ unknown |
| cleaning-biz-ambiguity | bug-hit-rate | ✓ | ✓ | 20/20 (100%) | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| cleaning-biz-ambiguity | tool-failure-rate | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | prompt-efficiency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | jtbd-completion | ✓ | ✗ | 17/20 (85%) | pass | pass | partial | partial | pass | pass | pass | pass | pass | pass | pass | partial | pass | pass | pass | pass | pass | pass | pass | pass |
| cleaning-biz-ambiguity | output-quality | — | — | — | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | ⚠️ unknown | pass | pass | pass | pass | pass | pass | pass | pass |
| cleaning-biz-ambiguity | agent-steps | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | latency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | tool-parallelism | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | tool-batching-efficiency | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | turn-duration | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | token-usage | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | intent-to-output-alignment | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | implicit-feature-gap | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | observed | observed | observed | observed | observed |
| cleaning-biz-ambiguity | silent-hallucination | — | — | — | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | observed | ⚠️ unknown | observed | observed | observed | observed | observed | observed | observed | observed |

### simple-portfolio

**Trials:** 20 | **Duration:** 2h 5m 29s | **Avg Duration:** 6m 16s | **Avg Turns:** 5 | **Tool Errors:** 11

#### Scores

| Evaluator | pass@k | pass^k | Pass Rate | Mean | Range | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | T18 | T19 | T20 |
|-----------|--------|--------|-----------|------|-------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| bug-hit-rate | pass | pass | 20/20 (100%) | 1.00 | 1.00-1.00 | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) |
| tool-failure-rate | — | — | — | 0.02 | 0.00-0.06 | observed (0.00) | observed (0.06) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.04) | observed (0.00) | observed (0.00) | observed (0.05) | observed (0.00) | observed (0.03) | observed (0.00) | observed (0.04) | observed (0.00) | observed (0.06) | observed (0.00) | observed (0.00) | observed (0.03) |
| prompt-efficiency | — | — | — | 0.92 | 0.88-0.93 | observed (0.90) | observed (0.93) | observed (0.92) | observed (0.92) | observed (0.92) | observed (0.93) | observed (0.93) | observed (0.88) | observed (0.93) | observed (0.88) | observed (0.92) | observed (0.93) | observed (0.93) | observed (0.93) | observed (0.92) | observed (0.93) | observed (0.92) | observed (0.93) | observed (0.93) | observed (0.93) |
| jtbd-completion | pass | pass | 20/20 (100%) | 1.00 | 1.00-1.00 | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) |
| output-quality | — | — | — | 0.84 | 0.80-0.86 | pass (0.80) | pass (0.82) | pass (0.85) | pass (0.85) | pass (0.81) | pass (0.83) | pass (0.85) | pass (0.86) | pass (0.86) | pass (0.84) | pass (0.84) | pass (0.86) | pass (0.86) | pass (0.84) | pass (0.81) | pass (0.85) | pass (0.86) | pass (0.86) | pass (0.86) | pass (0.83) |
| agent-steps | — | — | — | 0.92 | 0.88-0.93 | observed (0.90) | observed (0.93) | observed (0.92) | observed (0.92) | observed (0.92) | observed (0.93) | observed (0.93) | observed (0.88) | observed (0.93) | observed (0.88) | observed (0.92) | observed (0.93) | observed (0.93) | observed (0.93) | observed (0.92) | observed (0.93) | observed (0.92) | observed (0.93) | observed (0.93) | observed (0.93) |
| latency | — | — | — | 0.09 | 0.00-0.49 | observed (0.46) | observed (0.00) | observed (0.43) | observed (0.01) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.07) | observed (0.00) | observed (0.02) | observed (0.05) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.49) | observed (0.01) | observed (0.20) | observed (0.01) | observed (0.01) | observed (0.01) |
| tool-parallelism | — | — | — | 0.03 | 0.01-0.10 | observed (0.10) | observed (0.01) | observed (0.04) | observed (0.05) | observed (0.03) | observed (0.02) | observed (0.03) | observed (0.04) | observed (0.04) | observed (0.02) | observed (0.02) | observed (0.02) | observed (0.02) | observed (0.05) | observed (0.06) | observed (0.03) | observed (0.02) | observed (0.03) | observed (0.02) | observed (0.02) |
| tool-batching-efficiency | — | — | — | 0.96 | 0.92-1.00 | observed (0.92) | observed (0.97) | observed (0.96) | observed (0.94) | observed (0.95) | observed (0.97) | observed (0.96) | observed (0.92) | observed (1.00) | observed (0.95) | observed (0.97) | observed (0.97) | observed (0.97) | observed (0.95) | observed (0.95) | observed (0.96) | observed (0.97) | observed (1.00) | observed (0.97) | observed (0.97) |
| turn-duration | — | — | — | 367169.15 | 144082.00-724511.00 | observed (306260.00) | observed (343242.00) | observed (210936.00) | observed (202274.00) | observed (248002.00) | observed (391056.00) | observed (374603.00) | observed (724511.00) | observed (190207.00) | observed (655618.00) | observed (557327.00) | observed (475431.00) | observed (483109.00) | observed (390219.00) | observed (270440.00) | observed (315458.00) | observed (259489.00) | observed (144082.00) | observed (440588.00) | observed (360531.00) |
| token-usage | — | — | — | 1229144.95 | 451986.00-2858453.00 | observed (1070806.00) | observed (1492015.00) | observed (994853.00) | observed (451986.00) | observed (692769.00) | observed (1382096.00) | observed (1001783.00) | observed (2553091.00) | observed (623470.00) | observed (2858453.00) | observed (1890775.00) | observed (1196401.00) | observed (1298469.00) | observed (723537.00) | observed (651654.00) | observed (1076823.00) | observed (1452671.00) | observed (479179.00) | observed (1356530.00) | observed (1335538.00) |
| intent-to-output-alignment | — | — | — | 0.94 | 0.85-1.00 | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.92) | observed (0.88) | observed (0.95) | observed (1.00) | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.92) | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.85) | observed (0.95) | observed (0.95) |
| implicit-feature-gap | — | — | — | 0.93 | 0.82-0.95 | observed (0.90) | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.92) | observed (0.90) | observed (0.95) | observed (0.95) | observed (0.95) | observed (0.92) | observed (0.95) | observed (0.95) | observed (0.88) | observed (0.92) | observed (0.95) | observed (0.95) | observed (0.92) | observed (0.92) | observed (0.82) | observed (0.95) |
| silent-hallucination | — | — | — | 0.84 | 0.82-0.92 | observed (0.85) | observed (0.82) | observed (0.85) | observed (0.82) | observed (0.82) | observed (0.82) | observed (0.85) | observed (0.92) | observed (0.85) | observed (0.82) | observed (0.82) | observed (0.85) | observed (0.85) | observed (0.82) | observed (0.82) | observed (0.85) | observed (0.85) | observed (0.82) | observed (0.85) | observed (0.82) |

<details>
<summary>output-quality breakdown</summary>

| Sub-Evaluator | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | T18 | T19 | T20 |
|---------------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| heading-hierarchy | 1.00 | 1.00 | 1.00 | 1.00 | 0.50 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| semantic-density | 0.14 | 0.15 | 0.23 | 0.21 | 0.19 | 0.18 | 0.22 | 0.19 | 0.24 | 0.17 | 0.24 | 0.27 | 0.19 | 0.19 | 0.17 | 0.23 | 0.19 | 0.22 | 0.26 | 0.29 |
| accessibility-coverage | 0.96 | 1.00 | 1.00 | 1.00 | 1.00 | 0.96 | 0.96 | 0.98 | 1.00 | 1.00 | 1.00 | 0.96 | 1.00 | 1.00 | 0.96 | 0.97 | 1.00 | 1.00 | 1.00 | 0.95 |
| link-quality | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| responsive-readiness | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| inline-style-ratio | 0.70 | 0.86 | 0.87 | 0.83 | 0.91 | 0.91 | 0.91 | 0.89 | 0.89 | 0.83 | 0.93 | 0.89 | 0.93 | 0.87 | 0.79 | 0.88 | 0.88 | 0.90 | 0.89 | 0.96 |
| component-decomposition | 0.73 | 0.73 | 0.85 | 0.85 | 0.96 | 0.73 | 0.85 | 0.96 | 0.85 | 0.85 | 0.73 | 0.85 | 0.85 | 0.73 | 0.73 | 0.80 | 0.96 | 0.85 | 0.85 | 0.73 |
| visual-coherence | 0.82 | 0.88 | 0.91 | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 | 0.82 | 0.88 | 0.88 | 0.88 | 0.85 | 0.88 | 0.88 | 0.88 | 0.88 | 0.82 |
| content-substance | 0.88 | 0.72 | 0.82 | 0.88 | 0.88 | 0.85 | 0.82 | 0.88 | 0.88 | 0.88 | 0.85 | 0.88 | 0.88 | 0.85 | 0.82 | 0.88 | 0.82 | 0.88 | 0.88 | 0.72 |

</details>

### multipage-catalog

**Trials:** 20 | **Duration:** 2h 47m 42s | **Avg Duration:** 8m 23s | **Avg Turns:** 8 | **Tool Errors:** 10 | **Capture Errors:** 4

#### Scores

| Evaluator | pass@k | pass^k | Pass Rate | Mean | Range | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | T18 | T19 | T20 |
|-----------|--------|--------|-----------|------|-------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| bug-hit-rate | pass | pass | 20/20 (100%) | 1.00 | 1.00-1.00 | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) |
| tool-failure-rate | — | — | — | 0.01 | 0.00-0.04 | observed (0.02) | observed (0.02) | observed (0.00) | observed (0.00) | observed (0.02) | observed (0.00) | observed (0.02) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.02) | observed (0.00) | observed (0.03) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.02) | observed (0.04) |
| prompt-efficiency | — | — | — | 0.90 | 0.90-0.92 | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.92) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.92) | observed (0.90) | observed (0.92) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.92) | observed (0.92) | observed (0.90) |
| jtbd-completion | pass | fail | 18/20 (90%) | 0.97 | 0.50-1.00 | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | partial (0.50) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | ⚠️ unknown (0.00) |
| output-quality | — | — | — | 0.83 | 0.78-0.86 | pass (0.82) | ⚠️ unknown (0.00) | pass (0.85) | pass (0.83) | pass (0.85) | pass (0.80) | pass (0.85) | pass (0.84) | pass (0.78) | pass (0.82) | ⚠️ unknown (0.00) | pass (0.85) | pass (0.84) | pass (0.78) | pass (0.84) | ⚠️ unknown (0.00) | pass (0.83) | pass (0.86) | pass (0.84) | ⚠️ unknown (0.00) |
| agent-steps | — | — | — | 0.90 | 0.90-0.92 | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.92) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.92) | observed (0.90) | observed (0.92) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.90) | observed (0.92) | observed (0.92) | observed (0.90) |
| latency | — | — | — | 0.21 | 0.03-0.43 | observed (0.27) | observed (0.43) | observed (0.35) | observed (0.05) | observed (0.30) | observed (0.19) | observed (0.12) | observed (0.09) | observed (0.12) | observed (0.07) | observed (0.09) | observed (0.07) | observed (0.03) | observed (0.42) | observed (0.30) | observed (0.31) | observed (0.11) | observed (0.30) | observed (0.33) | observed (0.21) |
| tool-parallelism | — | — | — | 0.05 | 0.02-0.12 | observed (0.02) | observed (0.03) | observed (0.04) | observed (0.04) | observed (0.04) | observed (0.04) | observed (0.07) | observed (0.08) | observed (0.04) | observed (0.08) | observed (0.10) | observed (0.07) | observed (0.12) | observed (0.03) | observed (0.02) | observed (0.04) | observed (0.04) | observed (0.03) | observed (0.04) | observed (0.05) |
| tool-batching-efficiency | — | — | — | 0.98 | 0.96-1.00 | observed (0.96) | observed (0.98) | observed (0.97) | observed (0.96) | observed (1.00) | observed (0.97) | observed (0.97) | observed (0.98) | observed (0.98) | observed (0.96) | observed (1.00) | observed (0.96) | observed (0.96) | observed (0.98) | observed (0.98) | observed (0.97) | observed (0.96) | observed (1.00) | observed (0.96) | observed (1.00) |
| turn-duration | — | — | — | 486212.05 | 377806.00-667166.00 | observed (470404.00) | observed (377806.00) | observed (456136.00) | observed (502165.00) | observed (433084.00) | observed (502112.00) | observed (500844.00) | observed (450493.00) | observed (513819.00) | observed (604646.00) | observed (475652.00) | observed (667166.00) | observed (631840.00) | observed (451747.00) | observed (498984.00) | observed (429485.00) | observed (474192.00) | observed (442401.00) | observed (419354.00) | observed (421911.00) |
| token-usage | — | — | — | 1662346.70 | 1073895.00-2545290.00 | observed (1991155.00) | observed (1736419.00) | observed (1959261.00) | observed (1966614.00) | observed (1231271.00) | observed (1804116.00) | observed (1459060.00) | observed (1385878.00) | observed (1427346.00) | observed (1974102.00) | observed (1073895.00) | observed (2200510.00) | observed (1571050.00) | observed (1840720.00) | observed (2545290.00) | observed (1206386.00) | observed (1815701.00) | observed (1474820.00) | observed (1377952.00) | observed (1205388.00) |
| intent-to-output-alignment | — | — | — | 0.86 | 0.82-0.95 | observed (0.85) | ⚠️ unknown (0.00) | observed (0.90) | observed (0.82) | observed (0.88) | observed (0.88) | observed (0.85) | observed (0.82) | observed (0.85) | observed (0.82) | ⚠️ unknown (0.00) | observed (0.95) | observed (0.88) | observed (0.82) | observed (0.88) | ⚠️ unknown (0.00) | observed (0.88) | observed (0.88) | observed (0.85) | ⚠️ unknown (0.00) |
| implicit-feature-gap | — | — | — | 0.81 | 0.72-0.88 | observed (0.72) | ⚠️ unknown (0.00) | observed (0.85) | observed (0.75) | observed (0.82) | observed (0.82) | observed (0.82) | observed (0.82) | observed (0.82) | observed (0.75) | ⚠️ unknown (0.00) | observed (0.88) | observed (0.82) | observed (0.75) | observed (0.85) | ⚠️ unknown (0.00) | observed (0.82) | observed (0.82) | observed (0.82) | ⚠️ unknown (0.00) |
| silent-hallucination | — | — | — | 0.75 | 0.45-0.88 | observed (0.72) | ⚠️ unknown (0.00) | observed (0.82) | observed (0.45) | observed (0.75) | observed (0.82) | observed (0.82) | observed (0.72) | observed (0.72) | observed (0.72) | ⚠️ unknown (0.00) | observed (0.88) | observed (0.82) | observed (0.72) | observed (0.72) | ⚠️ unknown (0.00) | observed (0.72) | observed (0.72) | observed (0.82) | ⚠️ unknown (0.00) |

<details>
<summary>Evaluator Reasoning</summary>

**jtbd-completion**
- T14: LLM judge verdict: partial

</details>

<details>
<summary>output-quality breakdown</summary>

| Sub-Evaluator | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | T18 | T19 | T20 |
|---------------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| heading-hierarchy | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | unknown |
| semantic-density | 0.14 | unknown | 0.22 | 0.14 | 0.24 | 0.16 | 0.11 | 0.14 | 0.17 | 0.14 | unknown | 0.13 | 0.18 | 0.22 | 0.17 | unknown | 0.16 | 0.23 | 0.15 | unknown |
| accessibility-coverage | 1.00 | unknown | 1.00 | 0.97 | 1.00 | 0.57 | 1.00 | 1.00 | 0.59 | 1.00 | unknown | 0.98 | 1.00 | 0.60 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | unknown |
| link-quality | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | unknown |
| responsive-readiness | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | unknown |
| inline-style-ratio | 0.87 | unknown | 0.92 | 0.90 | 0.74 | 0.89 | 0.94 | 0.93 | 0.86 | 0.81 | unknown | 0.91 | 0.90 | 0.61 | 0.89 | unknown | 0.91 | 0.91 | 0.88 | unknown |
| component-decomposition | 0.73 | unknown | 0.85 | 0.73 | 0.85 | 0.85 | 0.85 | 0.85 | 0.73 | 0.73 | unknown | 0.85 | 0.73 | 0.85 | 0.73 | unknown | 0.73 | 0.85 | 0.85 | unknown |
| visual-coherence | 0.82 | unknown | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 | 0.87 | 0.88 | 0.88 | unknown | 0.88 | 0.88 | 0.88 | 0.88 | unknown | 0.88 | 0.88 | 0.88 | unknown |
| content-substance | 0.82 | unknown | 0.82 | 0.88 | 0.92 | 0.82 | 0.92 | 0.82 | 0.82 | 0.82 | unknown | 0.92 | 0.82 | 0.82 | 0.88 | unknown | 0.82 | 0.88 | 0.82 | unknown |

</details>

### cleaning-biz-ambiguity

**Trials:** 20 | **Duration:** 2h 54m 17s | **Avg Duration:** 8m 43s | **Avg Turns:** 13 | **Tool Errors:** 11 | **Capture Errors:** 1

#### Scores

| Evaluator | pass@k | pass^k | Pass Rate | Mean | Range | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | T18 | T19 | T20 |
|-----------|--------|--------|-----------|------|-------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| bug-hit-rate | pass | pass | 20/20 (100%) | 1.00 | 1.00-1.00 | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) |
| tool-failure-rate | — | — | — | 0.01 | 0.00-0.10 | observed (0.00) | observed (0.00) | observed (0.10) | observed (0.04) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.00) | observed (0.06) | observed (0.00) | observed (0.03) | observed (0.00) | observed (0.03) | observed (0.00) |
| prompt-efficiency | — | — | — | 0.84 | 0.73-0.88 | observed (0.73) | observed (0.88) | observed (0.83) | observed (0.86) | observed (0.88) | observed (0.83) | observed (0.86) | observed (0.86) | observed (0.80) | observed (0.88) | observed (0.86) | observed (0.86) | observed (0.86) | observed (0.77) | observed (0.77) | observed (0.86) | observed (0.86) | observed (0.77) | observed (0.88) | observed (0.86) |
| jtbd-completion | pass | fail | 17/20 (85%) | 0.93 | 0.50-1.00 | pass (1.00) | pass (1.00) | partial (0.50) | partial (0.50) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | partial (0.50) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) | pass (1.00) |
| output-quality | — | — | — | 0.82 | 0.82-0.83 | pass (0.82) | pass (0.82) | pass (0.82) | pass (0.83) | pass (0.82) | pass (0.82) | pass (0.83) | pass (0.82) | pass (0.83) | pass (0.82) | pass (0.83) | ⚠️ unknown (0.00) | pass (0.83) | pass (0.83) | pass (0.83) | pass (0.83) | pass (0.82) | pass (0.83) | pass (0.83) | pass (0.83) |
| agent-steps | — | — | — | 0.84 | 0.73-0.88 | observed (0.73) | observed (0.88) | observed (0.83) | observed (0.86) | observed (0.88) | observed (0.83) | observed (0.86) | observed (0.86) | observed (0.80) | observed (0.88) | observed (0.86) | observed (0.86) | observed (0.86) | observed (0.77) | observed (0.77) | observed (0.86) | observed (0.86) | observed (0.77) | observed (0.88) | observed (0.86) |
| latency | — | — | — | 0.19 | 0.00-0.47 | observed (0.47) | observed (0.23) | observed (0.28) | observed (0.32) | observed (0.12) | observed (0.23) | observed (0.15) | observed (0.26) | observed (0.23) | observed (0.06) | observed (0.02) | observed (0.03) | observed (0.17) | observed (0.37) | observed (0.00) | observed (0.40) | observed (0.00) | observed (0.21) | observed (0.01) | observed (0.28) |
| tool-parallelism | — | — | — | 0.04 | 0.01-0.08 | observed (0.03) | observed (0.03) | observed (0.02) | observed (0.07) | observed (0.06) | observed (0.05) | observed (0.06) | observed (0.04) | observed (0.03) | observed (0.05) | observed (0.05) | observed (0.08) | observed (0.02) | observed (0.03) | observed (0.01) | observed (0.05) | observed (0.05) | observed (0.04) | observed (0.04) | observed (0.05) |
| tool-batching-efficiency | — | — | — | 0.91 | 0.88-0.94 | observed (0.88) | observed (0.90) | observed (0.91) | observed (0.88) | observed (0.90) | observed (0.91) | observed (0.91) | observed (0.91) | observed (0.89) | observed (0.93) | observed (0.91) | observed (0.94) | observed (0.91) | observed (0.88) | observed (0.89) | observed (0.93) | observed (0.91) | observed (0.92) | observed (0.94) | observed (0.94) |
| turn-duration | — | — | — | 500551.45 | 300839.00-705319.00 | observed (508553.00) | observed (428318.00) | observed (300839.00) | observed (410344.00) | observed (428888.00) | observed (520083.00) | observed (387219.00) | observed (478056.00) | observed (528018.00) | observed (613159.00) | observed (621493.00) | observed (634461.00) | observed (566039.00) | observed (512241.00) | observed (704747.00) | observed (341369.00) | observed (471598.00) | observed (705319.00) | observed (404079.00) | observed (446206.00) |
| token-usage | — | — | — | 1808572.80 | 1110587.00-4248776.00 | observed (2249023.00) | observed (1364340.00) | observed (1702076.00) | observed (1110587.00) | observed (1441641.00) | observed (1693642.00) | observed (1231391.00) | observed (1411625.00) | observed (1907121.00) | observed (1922196.00) | observed (1408210.00) | observed (1580372.00) | observed (3095559.00) | observed (1639869.00) | observed (4248776.00) | observed (1153445.00) | observed (1513178.00) | observed (2879375.00) | observed (1240737.00) | observed (1378293.00) |
| intent-to-output-alignment | — | — | — | 0.93 | 0.92-0.95 | observed (0.92) | observed (0.92) | observed (0.95) | observed (0.95) | observed (0.92) | observed (0.95) | observed (0.95) | observed (0.92) | observed (0.92) | observed (0.95) | observed (0.95) | ⚠️ unknown (0.00) | observed (0.92) | observed (0.92) | observed (0.92) | observed (0.92) | observed (0.95) | observed (0.93) | observed (0.95) | observed (0.92) |
| implicit-feature-gap | — | — | — | 0.87 | 0.82-0.92 | observed (0.85) | observed (0.85) | observed (0.82) | observed (0.88) | observed (0.88) | observed (0.90) | observed (0.88) | observed (0.88) | observed (0.88) | observed (0.88) | observed (0.88) | ⚠️ unknown (0.00) | observed (0.88) | observed (0.92) | observed (0.92) | observed (0.92) | observed (0.85) | observed (0.82) | observed (0.82) | observed (0.88) |
| silent-hallucination | — | — | — | 0.85 | 0.82-0.95 | observed (0.85) | observed (0.82) | observed (0.82) | observed (0.82) | observed (0.82) | observed (0.85) | observed (0.85) | observed (0.82) | observed (0.82) | observed (0.95) | observed (0.85) | ⚠️ unknown (0.00) | observed (0.82) | observed (0.82) | observed (0.82) | observed (0.85) | observed (0.92) | observed (0.82) | observed (0.90) | observed (0.85) |

<details>
<summary>Evaluator Reasoning</summary>

**jtbd-completion**
- T3: LLM judge verdict: partial
- T4: LLM judge verdict: partial
- T12: LLM judge verdict: partial

</details>

<details>
<summary>output-quality breakdown</summary>

| Sub-Evaluator | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | T10 | T11 | T12 | T13 | T14 | T15 | T16 | T17 | T18 | T19 | T20 |
|---------------|----|----|----|----|----|----|----|----|----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| heading-hierarchy | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| semantic-density | 0.14 | 0.13 | 0.14 | 0.14 | 0.12 | 0.15 | 0.15 | 0.13 | 0.15 | 0.13 | 0.15 | unknown | 0.14 | 0.14 | 0.19 | 0.15 | 0.16 | 0.12 | 0.14 | 0.13 |
| accessibility-coverage | 0.97 | 0.96 | 1.00 | 0.97 | 0.97 | 0.97 | 0.97 | 0.97 | 0.97 | 0.96 | 0.97 | unknown | 0.97 | 0.97 | 1.00 | 0.97 | 0.97 | 0.97 | 0.97 | 0.97 |
| link-quality | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| responsive-readiness | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | unknown | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| inline-style-ratio | 0.87 | 0.89 | 0.84 | 0.90 | 0.90 | 0.87 | 0.88 | 0.89 | 0.88 | 0.85 | 0.91 | unknown | 0.90 | 0.85 | 0.87 | 0.89 | 0.79 | 0.92 | 0.88 | 0.89 |
| component-decomposition | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | unknown | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 | 0.73 |
| visual-coherence | 0.88 | 0.82 | 0.85 | 0.88 | 0.82 | 0.88 | 0.88 | 0.82 | 0.88 | 0.88 | 0.88 | unknown | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 | 0.88 |
| content-substance | 0.82 | 0.82 | 0.82 | 0.82 | unknown | 0.78 | 0.82 | 0.82 | 0.82 | 0.82 | 0.82 | unknown | 0.82 | 0.88 | 0.82 | 0.82 | 0.82 | 0.82 | 0.82 | 0.82 |

</details>

## ⚠️ Unknown Verdicts — Require Human Review

| Scenario | Evaluator | Trial | Reason |
|----------|-----------|-------|--------|
| multipage-catalog | output-quality | T2 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| multipage-catalog | intent-to-output-alignment | T2 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | implicit-feature-gap | T2 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | silent-hallucination | T2 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | output-quality | T11 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| multipage-catalog | intent-to-output-alignment | T11 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | implicit-feature-gap | T11 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | silent-hallucination | T11 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | output-quality | T16 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| multipage-catalog | intent-to-output-alignment | T16 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | implicit-feature-gap | T16 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | silent-hallucination | T16 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | jtbd-completion | T20 | LLM judge verdict: unknown |
| multipage-catalog | output-quality | T20 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| multipage-catalog | intent-to-output-alignment | T20 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | implicit-feature-gap | T20 | Evidence validation failed (snapshot unreadable or empty) |
| multipage-catalog | silent-hallucination | T20 | Evidence validation failed (snapshot unreadable or empty) |
| cleaning-biz-ambiguity | output-quality | T12 | Composite of 0/9 sub-evaluators (all unknown or errored) |
| cleaning-biz-ambiguity | intent-to-output-alignment | T12 | Evidence validation failed (snapshot unreadable or empty) |
| cleaning-biz-ambiguity | implicit-feature-gap | T12 | Evidence validation failed (snapshot unreadable or empty) |
| cleaning-biz-ambiguity | silent-hallucination | T12 | Evidence validation failed (snapshot unreadable or empty) |

## Trial Links

| Scenario | Trials |
|----------|--------|
| simple-portfolio | [T1](scenarios/simple-portfolio/trials/0/eval-results.md), [T2](scenarios/simple-portfolio/trials/1/eval-results.md), [T3](scenarios/simple-portfolio/trials/2/eval-results.md), [T4](scenarios/simple-portfolio/trials/3/eval-results.md), [T5](scenarios/simple-portfolio/trials/4/eval-results.md), [T6](scenarios/simple-portfolio/trials/5/eval-results.md), [T7](scenarios/simple-portfolio/trials/6/eval-results.md), [T8](scenarios/simple-portfolio/trials/7/eval-results.md), [T9](scenarios/simple-portfolio/trials/8/eval-results.md), [T10](scenarios/simple-portfolio/trials/9/eval-results.md), [T11](scenarios/simple-portfolio/trials/10/eval-results.md), [T12](scenarios/simple-portfolio/trials/11/eval-results.md), [T13](scenarios/simple-portfolio/trials/12/eval-results.md), [T14](scenarios/simple-portfolio/trials/13/eval-results.md), [T15](scenarios/simple-portfolio/trials/14/eval-results.md), [T16](scenarios/simple-portfolio/trials/15/eval-results.md), [T17](scenarios/simple-portfolio/trials/16/eval-results.md), [T18](scenarios/simple-portfolio/trials/17/eval-results.md), [T19](scenarios/simple-portfolio/trials/18/eval-results.md), [T20](scenarios/simple-portfolio/trials/19/eval-results.md) |
| multipage-catalog | [T1](scenarios/multipage-catalog/trials/0/eval-results.md), [T2](scenarios/multipage-catalog/trials/1/eval-results.md), [T3](scenarios/multipage-catalog/trials/2/eval-results.md), [T4](scenarios/multipage-catalog/trials/3/eval-results.md), [T5](scenarios/multipage-catalog/trials/4/eval-results.md), [T6](scenarios/multipage-catalog/trials/5/eval-results.md), [T7](scenarios/multipage-catalog/trials/6/eval-results.md), [T8](scenarios/multipage-catalog/trials/7/eval-results.md), [T9](scenarios/multipage-catalog/trials/8/eval-results.md), [T10](scenarios/multipage-catalog/trials/9/eval-results.md), [T11](scenarios/multipage-catalog/trials/10/eval-results.md), [T12](scenarios/multipage-catalog/trials/11/eval-results.md), [T13](scenarios/multipage-catalog/trials/12/eval-results.md), [T14](scenarios/multipage-catalog/trials/13/eval-results.md), [T15](scenarios/multipage-catalog/trials/14/eval-results.md), [T16](scenarios/multipage-catalog/trials/15/eval-results.md), [T17](scenarios/multipage-catalog/trials/16/eval-results.md), [T18](scenarios/multipage-catalog/trials/17/eval-results.md), [T19](scenarios/multipage-catalog/trials/18/eval-results.md), [T20](scenarios/multipage-catalog/trials/19/eval-results.md) |
| cleaning-biz-ambiguity | [T1](scenarios/cleaning-biz-ambiguity/trials/0/eval-results.md), [T2](scenarios/cleaning-biz-ambiguity/trials/1/eval-results.md), [T3](scenarios/cleaning-biz-ambiguity/trials/2/eval-results.md), [T4](scenarios/cleaning-biz-ambiguity/trials/3/eval-results.md), [T5](scenarios/cleaning-biz-ambiguity/trials/4/eval-results.md), [T6](scenarios/cleaning-biz-ambiguity/trials/5/eval-results.md), [T7](scenarios/cleaning-biz-ambiguity/trials/6/eval-results.md), [T8](scenarios/cleaning-biz-ambiguity/trials/7/eval-results.md), [T9](scenarios/cleaning-biz-ambiguity/trials/8/eval-results.md), [T10](scenarios/cleaning-biz-ambiguity/trials/9/eval-results.md), [T11](scenarios/cleaning-biz-ambiguity/trials/10/eval-results.md), [T12](scenarios/cleaning-biz-ambiguity/trials/11/eval-results.md), [T13](scenarios/cleaning-biz-ambiguity/trials/12/eval-results.md), [T14](scenarios/cleaning-biz-ambiguity/trials/13/eval-results.md), [T15](scenarios/cleaning-biz-ambiguity/trials/14/eval-results.md), [T16](scenarios/cleaning-biz-ambiguity/trials/15/eval-results.md), [T17](scenarios/cleaning-biz-ambiguity/trials/16/eval-results.md), [T18](scenarios/cleaning-biz-ambiguity/trials/17/eval-results.md), [T19](scenarios/cleaning-biz-ambiguity/trials/18/eval-results.md), [T20](scenarios/cleaning-biz-ambiguity/trials/19/eval-results.md) |