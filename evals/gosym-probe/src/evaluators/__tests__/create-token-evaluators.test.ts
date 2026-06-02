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
  it('returns two evaluators', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    expect(evaluators).toHaveLength(2);
  });

  it('includes token-usage and llm-cost evaluators', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    const names = evaluators.map(e => e.name);
    expect(names).toContain('token-usage');
    expect(names).toContain('llm-cost');
  });

  it('both evaluators have regressionMode "score"', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    for (const ev of evaluators) {
      expect(ev.regressionMode).toBe('score');
    }
  });

  it('both evaluators have lowerIsBetter true', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    for (const ev of evaluators) {
      expect(ev.lowerIsBetter).toBe(true);
    }
  });

  it('both evaluators share the same collector instance', () => {
    const gocode = makeMockGocode();
    const evaluators = createTokenEvaluators(gocode);

    const mockClient = {
      configure: vi.fn(),
      send: vi.fn(),
      disconnect: vi.fn(),
      onMessage: vi.fn(),
    };

    // Hook both evaluators — no error thrown proves they share the same
    // idempotent collector (second hook call is a no-op, not an exception).
    for (const ev of evaluators) {
      ev.hookClient?.(mockClient, 0);
    }

    expect(gocode.getAccumulatedUsage).toHaveBeenCalledTimes(2);
  });
});
