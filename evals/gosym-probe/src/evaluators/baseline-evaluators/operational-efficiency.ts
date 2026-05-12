import type { EvalResult, Evaluator } from '../evaluator.js';
import type { DOMSnapshot, Transcript } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import { clamp01 } from './shared.js';

// Tuned for ~30-turn conversations: perfect at <=108s, zero at >=720s.
const PERFECT_SECONDS = 108;
const ZERO_SECONDS = 720;

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

function mapDurationToScore(seconds: number): number {
  if (seconds <= PERFECT_SECONDS) return 1.0;
  if (seconds >= ZERO_SECONDS) return 0.0;
  return clamp01(
    1 - (
      (seconds - PERFECT_SECONDS)
      / (ZERO_SECONDS - PERFECT_SECONDS)
    ),
  );
}

function verdictFromScore(score: number): EvalResult['verdict'] {
  if (score >= 0.7) return 'pass';
  if (score >= 0.4) return 'partial';
  return 'fail';
}

export class TotalTimeTakenEvaluator implements Evaluator {
  readonly name = 'total-time-taken';
  readonly evalVersion = '1.1';

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
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
        evalVersion: this.evalVersion,
      };
    }

    const ms = end - start;
    const seconds = ms / 1000;
    const score = mapDurationToScore(seconds);

    return {
      evaluator: this.name,
      score,
      verdict: verdictFromScore(score),
      reason: `Total session time: ${seconds.toFixed(1)}s`,
      evalVersion: this.evalVersion,
      details: {
        unit: 'seconds',
        seconds,
        ms,
        startMs: start,
        endMs: end,
        perfectSeconds: PERFECT_SECONDS,
        zeroSeconds: ZERO_SECONDS,
      },
    };
  }
}
