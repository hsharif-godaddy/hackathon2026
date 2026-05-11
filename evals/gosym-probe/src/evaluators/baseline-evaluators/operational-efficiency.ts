import type { EvalResult, Evaluator } from '../evaluator.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import { clamp01 } from './shared.js';

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function firstTurnMs(transcript: Transcript): number | null {
  const first = transcript.turns[0];
  if (!first) return null;
  return Number.isFinite(first.timestamp) ? first.timestamp : null;
}

function lastTurnMs(transcript: Transcript): number | null {
  const last = transcript.turns.length > 0
    ? transcript.turns[transcript.turns.length - 1]
    : null;
  if (!last) return null;
  return Number.isFinite(last.timestamp) ? last.timestamp : null;
}

function lastSnapshotMs(snapshot?: DOMSnapshot): number | null {
  return parseIsoMs(snapshot?.timestamp);
}

function timeThresholds(maxTurns: number | undefined): {
  perfectSeconds: number;
  zeroSeconds: number;
} {
  const scale = Math.max(maxTurns ?? 25, 1) / 25;
  return {
    perfectSeconds: 90 * scale,
    zeroSeconds: 600 * scale,
  };
}

function mapDurationToScore(
  seconds: number,
  thresholds: { perfectSeconds: number; zeroSeconds: number },
): number {
  if (seconds <= thresholds.perfectSeconds) return 1.0;
  if (seconds >= thresholds.zeroSeconds) return 0.0;
  return clamp01(
    1 - (
      (seconds - thresholds.perfectSeconds)
      / (thresholds.zeroSeconds - thresholds.perfectSeconds)
    ),
  );
}

function verdictFromScore(score: number): EvalResult['verdict'] {
  if (score >= 0.7) return 'pass';
  if (score >= 0.4) return 'partial';
  return 'fail';
}

export class TotalTimeTakenEvaluator implements Evaluator {
  readonly name = 'total_time_taken';
  readonly deterministic = true;

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const start = firstTurnMs(transcript);
    const endTurn = lastTurnMs(transcript);
    const endSnap = lastSnapshotMs(snapshot);
    const end = Math.max(endTurn ?? 0, endSnap ?? 0) || null;

    if (start === null || end === null || end < start) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'Insufficient timestamps to compute total time taken',
      };
    }

    const ms = end - start;
    const seconds = ms / 1000;
    const thresholds = timeThresholds(scenario.maxTurns);
    const score = mapDurationToScore(seconds, thresholds);

    return {
      evaluator: this.name,
      score,
      verdict: verdictFromScore(score),
      reason: `Total session time: ${seconds.toFixed(1)}s`,
      details: {
        unit: 'seconds',
        seconds,
        ms,
        startMs: start,
        endMs: end,
        maxTurns: scenario.maxTurns,
        perfectSeconds: thresholds.perfectSeconds,
        zeroSeconds: thresholds.zeroSeconds,
      },
    };
  }
}
