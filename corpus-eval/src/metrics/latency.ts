import type { CaseResult, LatencyStats } from '../corpus/types.js';

/**
 * Calculate latency statistics from case results.
 *
 * Note on p50 (median): This is the 50th percentile, meaning half of all
 * observations fall below this value. Unlike the average, it's resistant
 * to outliers (e.g., occasional timeouts won't skew it).
 */
export function calculateLatencyStats(results: CaseResult[]): LatencyStats {
  if (results.length === 0) {
    return {
      avg: 0,
      p50: 0,
      p95: 0,
      min: 0,
      max: 0,
    };
  }

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);

  const sum = latencies.reduce((a, b) => a + b, 0);
  const avg = sum / latencies.length;

  const p50Index = Math.floor(latencies.length * 0.5);
  const p95Index = Math.floor(latencies.length * 0.95);

  return {
    avg: Math.round(avg),
    p50: latencies[p50Index],
    p95: latencies[Math.min(p95Index, latencies.length - 1)],
    min: latencies[0],
    max: latencies[latencies.length - 1],
  };
}

/**
 * Calculate latency stats grouped by path
 */
export function calculateLatencyByPath(
  results: CaseResult[]
): Record<string, LatencyStats> {
  const paths = ['embedding', 'haiku', 'initial_prompt', 'timeout', 'error'] as const;
  const stats: Record<string, LatencyStats> = {};

  for (const path of paths) {
    const pathResults = results.filter(r => r.actual.path === path);
    stats[path] = calculateLatencyStats(pathResults);
  }

  return stats;
}

/**
 * Format latency stats as a string
 */
export function formatLatencyStats(stats: LatencyStats): string {
  return `avg=${stats.avg}ms, p50=${stats.p50}ms, p95=${stats.p95}ms, min=${stats.min}ms, max=${stats.max}ms`;
}
