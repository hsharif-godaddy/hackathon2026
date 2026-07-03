import { describe, it, expect, vi } from 'vitest';
import { createTokenEvaluators } from '../create-token-evaluators.js';
import type { ProbeUsageSource } from '../../clients/gocode-client.js';

function makeMockGocode(): ProbeUsageSource & { getModel(): string } {
  return {
    getAccumulatedUsage: vi.fn(function () { return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    }; }),
    getModel: () => 'claude-sonnet-4-6',
  };
}

describe('createTokenEvaluators', () => {
  it('returns four evaluators', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    expect(evaluators).toHaveLength(4);
  });

  it('includes total + output-only token and cost evaluators', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    const names = evaluators.map(e => e.name);
    expect(names).toContain('token-usage');
    expect(names).toContain('llm-cost');
    expect(names).toContain('output-token-usage');
    expect(names).toContain('output-cost');
  });

  it('all evaluators have comparisonMode "score"', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    for (const ev of evaluators) {
      expect(ev.comparisonMode).toBe('score');
    }
  });

  it('all evaluators have lowerIsBetter true', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    for (const ev of evaluators) {
      expect(ev.lowerIsBetter).toBe(true);
    }
  });

  it('all evaluators share the same collector instance', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    const mockClient = {
      configure: vi.fn(),
      send: vi.fn(),
      disconnect: vi.fn(),
      onMessage: vi.fn(),
    };

    // Hook all evaluators — no error thrown proves they share the same
    // idempotent collector (later hook calls are no-ops, not exceptions).
    for (const ev of evaluators) {
      ev.hookClient?.(mockClient, 0);
    }

    // Each evaluator snapshots the probe baseline once at hook time.
    expect(gocode.getAccumulatedUsage).toHaveBeenCalledTimes(4);
  });
});
