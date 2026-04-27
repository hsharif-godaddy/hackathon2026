# Friction Score Formula Reference

Canonical formulas for the severity-based pattern detection system used in cost attribution.

## Severity Curve

```
severity_curve(value, threshold) = clamp(log(value / threshold) / log(5), 0, 1)
```

- Values at or below threshold yield 0.
- Scales logarithmically up to 1.0 at 5× threshold.
- Log scale compresses extremes: what matters is that friction happened, not how catastrophically.

## Pattern Formulas

All severities are clamped to [0, 1].

### repeated_reads

```
severity = severity_curve(max_reads_same_file, 3)
```

Fires when: same file read ≥ 3 times. Uses max read count across all files.

### repeated_edits

```
severity = severity_curve(max_edits_same_file, 5)
```

Fires when: same file edited ≥ 5 times. Uses max edit count across all files.

### grep_spiral

```
severity = min((grep_count / 5) * empty_result_ratio, 1.0)
```

- `empty_result_ratio` = greps returning empty / total greps
- Zero severity when all greps succeed, regardless of volume — productive searching is not waste
- Linear scaling on count, capped at 1.0
- Validated on 62,259 traces with zero false positives at cutoff ≥ 0.05

Fires when: grep_count ≥ 5.

| Scenario                        | Severity            |
| ------------------------------- | ------------------- |
| 19 greps, all empty (ratio=1.0) | min(3.8, 1.0) = 1.0 |
| 19 greps, all found (ratio=0.0) | 3.8 × 0.0 = 0.0     |
| 6 greps, half empty (ratio=0.5) | 1.2 × 0.5 = 0.6     |

Design choice: linear (not log) because what matters for greps is the ratio of waste, not compressed magnitude. An agent doing 19 productive greps scores zero — correct for a billing system where false positives cost GoDaddy money.

### terminal_failures

```
severity = severity_curve(failed_terminal_commands, 3) * fail_ratio
```

- `fail_ratio` = failed terminal commands / total terminal commands
- Pure ratio scaling — severity drops proportionally with productive work
- 3 failures out of 20 commands = agent doing real work with expected hiccups (type-check → fix → retry)
- 3 failures out of 4 commands = agent stuck in a tight failure loop

Fires when: terminal_failure_count ≥ 3.

| Scenario                         | Severity          |
| -------------------------------- | ----------------- |
| 4 fails / 4 total (ratio=1.0)    | 0.18 × 1.0 = 0.18 |
| 4 fails / 20 total (ratio=0.2)   | 0.18 × 0.2 = 0.04 |
| 3 fails / 100 total (ratio=0.03) | 0.0 × 0.03 = 0.0  |

Design choice: no floor (pure ratio, not `0.3 + 0.7 * fail_ratio`) because in a billing context, an agent with a low failure ratio is doing legitimate work. Only tight failure loops should trigger attribution.

### edit_read_loops

```
Per file: loop_count = floor(transitions_between_read_and_edit / 2)
Use max loop_count across all files.
severity = severity_curve(max_loop_count, 3)
```

Fires when: ≥ 3 edit→read→edit cycles on the same file (using max across files).

## Fired-Pattern Semantics

- A pattern is **detected** when raw count reaches threshold (≥), even if severity is 0 at exact threshold.
- `firedPatterns` used for **attribution category** must contain only patterns with severity > 0, to avoid zero-severity dominant-category artifacts.

Detection thresholds:

| Pattern           | Fires when                 |
| ----------------- | -------------------------- |
| repeated_reads    | max_same_file_reads ≥ 3    |
| repeated_edits    | max_same_file_edits ≥ 5    |
| grep_spiral       | grep_count ≥ 5             |
| terminal_failures | terminal_failure_count ≥ 3 |
| edit_read_loops   | edit_read_loop_cycles ≥ 3  |

## Composite Friction Score

```
frictionScore = sum(weight_i * severity_i) / sum(all_weights)
```

Only patterns with severity > 0 contribute to the numerator. The denominator is **always** the sum of all weights (5.5), so a single severe pattern cannot produce a score of 1.0.

### Weights

| Pattern           | Weight | Rationale                                               |
| ----------------- | ------ | ------------------------------------------------------- |
| repeated_reads    | 1.0    | Baseline                                                |
| repeated_edits    | 1.0    | Baseline                                                |
| grep_spiral       | 1.5    | Highest — empty searches produce zero value, pure waste |
| terminal_failures | 0.8    | Lowest — some failures are legitimate (typecheck → fix) |
| edit_read_loops   | 1.2    | Each avoidable full LLM round is expensive              |

Sum of all weights: **5.5**

## Score Interpretation

| Range       | Meaning                                         |
| ----------- | ----------------------------------------------- |
| 0.00 – 0.04 | Clean — no meaningful friction                  |
| 0.05 – 0.09 | Mild — typically one pattern, sub-threshold     |
| 0.10 – 0.19 | Moderate — one strong pattern or multiple mild  |
| 0.20+       | High friction — boosts judge confidence (+3)    |
| 0.30+       | Severe — unambiguous misbehavior, confidence +5 |

A score of 0.20 typically requires either a high-severity pattern (e.g., grep_spiral at 0.73+) or multiple co-occurring patterns. Friction is a confidence/validation signal for the judge agent, not a direct attribution override.

## No-Value-Delivered Override

A top-level override (checked before friction scoring) that catches silent failures where the agent burned tokens but delivered nothing.

```
noValueDelivered = !hasOutput && !hasSuccessfulToolCalls && !wasUserAborted
```

- `hasOutput` — agent streamed text content to the client
- `hasSuccessfulToolCalls` — at least one tool call completed successfully (covers handoffs, stop-after tools, pure tool execution)
- `wasUserAborted` — user clicked stop (abort is their choice, not an agent failure)

When `noValueDelivered = true`: 100% GoDaddy, label `NoOutput`.

### Why a compound condition

`hasOutput = false` alone has valid false-positive scenarios:

- **Handoffs** — agent routes to another agent, no text, but a successful tool call
- **Stop-after tools** — `requestSecrets`, `suggestedResponse` halt for user input via tool call
- **Pure tool execution** — agent runs a command, succeeds, no commentary needed
- **User abort** — customer cancelled before output, not an agent failure

The compound condition filters all of these out. What remains: the agent ran, no tools succeeded, no text was produced, and the user didn't cancel. Near-certain agent failure.

### Priority in attribution

```
1. Retry of failed work     → 100% GoDaddy (RetryOfFailed)
2. Full override intent      → 100% GoDaddy (PublishTask/DomainTask)
3. No value delivered         → 100% GoDaddy (NoOutput)
4. Fix reclassified          → 100% Customer
5. Has failures / friction   → per-call attribution via friction score
6. No failures               → 100% Customer
```

### Data source

The transport layer already tracks streamed content via `streamingEvents` and publishes tool call results. `wasUserAborted` is available from the abort signal / `finishReason`. These signals are passed to `onExecutionAnalysis` or derived in `onBudgetReport`.

## Worked Example

A trace with: 8 reads of the same file, 19 greps (all empty), 4 terminal failures out of 4 commands.

```
repeated_reads:    severity_curve(8, 3) = log(8/3)/log(5) = 0.61
                   weight 1.0 → contribution = 0.61

grep_spiral:       min((19/5) × 1.0, 1.0) = 1.0
                   weight 1.5 → contribution = 1.50

terminal_failures: severity_curve(4, 3) × (4/4) = 0.18 × 1.0 = 0.18
                   weight 0.8 → contribution = 0.14

repeated_edits:    not fired → 0.0
edit_read_loops:   not fired → 0.0

frictionScore = (0.61 + 1.50 + 0.14) / 5.5 = 2.25 / 5.5 = 0.41

firedPatterns = ['repeated_reads', 'grep_spiral', 'terminal_failures']
```

Score 0.41 → well above 0.20 cutoff → high friction flagged, judge confidence boosted. Dominant category: `grep_spiral` (highest weighted contribution).

## Note on Log Precision

`severity_curve(4, 3)` = `ln(4/3) / ln(5)` = `0.2877 / 1.6094` ≈ **0.179**, not 0.25 as stated in some external documentation. All implementations use the precise formula.
