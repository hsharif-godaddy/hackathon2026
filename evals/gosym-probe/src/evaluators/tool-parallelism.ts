import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript, ToolCall } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

export class ToolParallelismEvaluator implements Evaluator {
  readonly name = 'tool-parallelism';
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = false;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const assistantTurns = transcript.turns.filter((t) => t.role === 'assistant');

    const perTurnRatios: Array<{ toolCallCount: number; ratio: number }> = [];
    let weightedNumerator = 0;
    let totalWeight = 0;

    for (const turn of assistantTurns) {
      const validCalls = filterValidToolCalls(turn.toolCalls);
      if (validCalls.length < 2) continue;

      const ratio = computeParallelismRatio(validCalls);
      const weight = validCalls.length;
      weightedNumerator += ratio * weight;
      totalWeight += weight;
      perTurnRatios.push({ toolCallCount: validCalls.length, ratio });
    }

    if (totalWeight === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No assistant turns with 2+ valid tool calls',
        details: { turnsAnalyzed: 0, totalWeight: 0, perTurnRatios: [] },
      };
    }

    const score = weightedNumerator / totalWeight;

    return {
      evaluator: this.name,
      score,
      verdict: 'observed',
      reason: `Tool parallelism ratio: ${(score * 100).toFixed(0)}%`,
      details: {
        turnsAnalyzed: perTurnRatios.length,
        totalWeight,
        perTurnRatios,
      },
    };
  }
}

function filterValidToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  return toolCalls.filter(
    (tc) =>
      Number.isFinite(tc.startTime) &&
      Number.isFinite(tc.endTime) &&
      tc.endTime > tc.startTime,
  );
}

function computeParallelismRatio(validCalls: ToolCall[]): number {
  const n = validCalls.length;
  if (n < 2) return 0;
  const sorted = [...validCalls].sort((a, b) => a.startTime - b.startTime);
  const maxPairs = (n * (n - 1)) / 2;

  let overlappingPairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // sorted[j].startTime >= sorted[i].startTime by sort order
      // overlap if j starts before i ends
      if (sorted[j].startTime < sorted[i].endTime) {
        overlappingPairs++;
      }
    }
  }

  return overlappingPairs / maxPairs;
}
