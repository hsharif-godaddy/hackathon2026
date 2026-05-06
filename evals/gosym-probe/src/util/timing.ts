import type { Turn } from '../runner/transcript.js';
import type { TimingStats } from '../store/types.js';

/**
 * Returns the elapsed time in milliseconds for a trial's turn array.
 * Computed as last turn timestamp minus first turn timestamp.
 * Returns 0 when fewer than 2 turns are present.
 */
export function trialDurationMs(turns: readonly Turn[]): number {
  if (turns.length < 2) return 0;
  const delta = turns[turns.length - 1].timestamp - turns[0].timestamp;
  return Number.isFinite(delta) ? Math.max(0, delta) : 0;
}

/**
 * Aggregates timing stats across a set of trial-like objects.
 * Returns unrounded avgTurnsPerTrial so callers control display precision.
 */
export function computeTimingStats(
  trials: ReadonlyArray<{ transcript: { turns: readonly Turn[] } }>,
): TimingStats {
  if (trials.length === 0) {
    return { totalDurationMs: 0, avgTrialDurationMs: 0, avgTurnsPerTrial: 0 };
  }

  let totalDurationMs = 0;
  let totalTurns = 0;

  for (const trial of trials) {
    const turns = trial.transcript.turns;
    totalTurns += turns.length;
    totalDurationMs += trialDurationMs(turns);
  }

  return {
    totalDurationMs,
    avgTrialDurationMs: totalDurationMs / trials.length,
    avgTurnsPerTrial: totalTurns / trials.length,
  };
}

/**
 * Formats a duration in milliseconds to a human-readable string.
 * Returns "0s" for zero or negative values.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';

  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
