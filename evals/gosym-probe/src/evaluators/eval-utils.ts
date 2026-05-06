import type { EvalResult } from './evaluator.js';
import type { ProbeUsage } from '../clients/gocode-client.js';

export const PASS_THRESHOLD = 0.7;
export const PARTIAL_THRESHOLD = 0.4;

export const ZERO_PROBE: ProbeUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 0,
};

export function scoreToVerdict(score: number): EvalResult['verdict'] {
  if (score >= PASS_THRESHOLD) return 'pass';
  if (score >= PARTIAL_THRESHOLD) return 'partial';
  return 'fail';
}

export function computeProbeDelta(
  current: ProbeUsage,
  baseline: ProbeUsage | undefined,
): ProbeUsage {
  if (!baseline) return { ...ZERO_PROBE };
  return {
    promptTokens: Math.max(0, current.promptTokens - baseline.promptTokens),
    completionTokens: Math.max(0, current.completionTokens - baseline.completionTokens),
    totalTokens: Math.max(0, current.totalTokens - baseline.totalTokens),
    calls: Math.max(0, current.calls - baseline.calls),
  };
}
