import type { ScoreStats } from '../store/types.js';

export function computeScoreStats(scores: number[]): ScoreStats {
  if (scores.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, stddev: 0 };
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  const variance =
    scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) /
    scores.length;

  return { min, max, mean, median, stddev: Math.sqrt(variance) };
}
