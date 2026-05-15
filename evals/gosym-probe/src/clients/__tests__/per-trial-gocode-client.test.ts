import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { PerTrialGocodeClient } from '../per-trial-gocode-client.js';
import type { Message } from '../gocode-client.js';

const TEST_CONFIG = {
  baseUrl: 'https://gocode.example.com/v1',
  apiKey: 'sk-test',
  model: 'claude-sonnet-4-6',
} as const;

const USAGE_RESPONSE = {
  choices: [{ message: { content: 'ok' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

const MESSAGES: Message[] = [{ role: 'user', content: 'hello' }];
const SCENARIO = 'test-scenario';

function makeClient(): PerTrialGocodeClient {
  return new PerTrialGocodeClient(TEST_CONFIG);
}

describe('PerTrialGocodeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Validation boundary: outside-scope throws
  // ---------------------------------------------------------------------------
  describe('outside trial scope', () => {
    it('complete() throws outside runInScope', async () => {
      const client = makeClient();
      await expect(client.complete(MESSAGES)).rejects.toThrow(
        'outside a trial scope',
      );
    });

    it('getAccumulatedUsage() throws outside runInScope', () => {
      const client = makeClient();
      expect(() => client.getAccumulatedUsage()).toThrow('outside a trial scope');
    });

    it('resetAccumulatedUsage() throws outside runInScope', () => {
      const client = makeClient();
      expect(() => client.resetAccumulatedUsage()).toThrow('outside a trial scope');
    });

    it('getModel() does NOT throw outside runInScope', () => {
      const client = makeClient();
      expect(() => client.getModel()).not.toThrow();
      expect(client.getModel()).toBe(TEST_CONFIG.model);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation boundary: nested scope routing
  // ---------------------------------------------------------------------------
  describe('nested scope routing', () => {
    it('resolves to inner scope when nested', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      await client.runInScope(SCENARIO, 0, async () => {
        await client.runInScope(SCENARIO, 1, async () => {
          await client.complete(MESSAGES);
        });
        const usage = client.getAccumulatedUsage();
        // The complete() call happened in trial 1's scope; trial 0 is fresh
        expect(usage.calls).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // State isolation: concurrent scopes
  // ---------------------------------------------------------------------------
  describe('concurrent scope isolation', () => {
    it('two concurrent scopes accumulate independently', async () => {
      const client = makeClient();

      // Trial 0 makes 2 calls, trial 1 makes 1 call — run concurrently
      mockCreate.mockResolvedValue(USAGE_RESPONSE);

      const trial0 = client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      const trial1 = client.runInScope(SCENARIO, 1, async () => {
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      const [usage0, usage1] = await Promise.all([trial0, trial1]);

      expect(usage0.calls).toBe(2);
      expect(usage1.calls).toBe(1);
    });

    it('trial 0 tokens do not appear in trial 1', async () => {
      const client = makeClient();

      mockCreate.mockResolvedValue(USAGE_RESPONSE);

      const trial0 = client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      const trial1 = client.runInScope(SCENARIO, 1, async () => {
        return client.getAccumulatedUsage();
      });

      const [, usage1] = await Promise.all([trial0, trial1]);
      expect(usage1.totalTokens).toBe(0);
    });

    it('same trialIndex in different scenarios are isolated', async () => {
      const client = makeClient();
      mockCreate.mockResolvedValue(USAGE_RESPONSE);

      const scenarioA = client.runInScope('scenario-a', 0, async () => {
        await client.complete(MESSAGES);
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      const scenarioB = client.runInScope('scenario-b', 0, async () => {
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      const [usageA, usageB] = await Promise.all([scenarioA, scenarioB]);

      expect(usageA.calls).toBe(2);
      expect(usageB.calls).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // State isolation: sequential fresh-start after release
  // ---------------------------------------------------------------------------
  describe('sequential fresh-start after release', () => {
    it('starts at zero usage after release and re-entry', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      await client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
      });

      client.release(SCENARIO, 0);

      const usage = await client.runInScope(SCENARIO, 0, async () => {
        return client.getAccumulatedUsage();
      });

      expect(usage.calls).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle: release() idempotency
  // ---------------------------------------------------------------------------
  describe('release()', () => {
    it('is idempotent — double release does not throw', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      await client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
      });

      expect(() => {
        client.release(SCENARIO, 0);
        client.release(SCENARIO, 0);
      }).not.toThrow();
    });

    it('release() for non-existent key is a no-op', () => {
      const client = makeClient();
      expect(() => client.release(SCENARIO, 99)).not.toThrow();
    });

    it('release for one scenario does not affect another', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      await client.runInScope('scenario-a', 0, async () => {
        await client.complete(MESSAGES);
      });
      await client.runInScope('scenario-b', 0, async () => {
        await client.complete(MESSAGES);
      });

      client.release('scenario-a', 0);

      const usage = await client.runInScope('scenario-b', 0, async () => {
        return client.getAccumulatedUsage();
      });

      expect(usage.calls).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle: lazy re-creation after release
  // ---------------------------------------------------------------------------
  describe('lazy re-creation', () => {
    it('new instance starts at zero usage after release', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      // Accumulate usage in trial 0
      await client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
      });

      client.release(SCENARIO, 0);

      // Re-enter — should see zero usage
      const usage = await client.runInScope(SCENARIO, 0, async () => {
        return client.getAccumulatedUsage();
      });

      expect(usage.calls).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('trialIndex=0 works correctly', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      const usage = await client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      expect(usage.calls).toBe(1);
    });

    it('large trialIndex works correctly', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      const usage = await client.runInScope(SCENARIO, 9999, async () => {
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      expect(usage.calls).toBe(1);
    });

    it('rapid create/release cycle does not corrupt state', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      for (let i = 0; i < 10; i++) {
        await client.runInScope(SCENARIO, 0, async () => {
          await client.complete(MESSAGES);
        });
        client.release(SCENARIO, 0);
      }

      const usage = await client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
        return client.getAccumulatedUsage();
      });

      expect(usage.calls).toBe(1);
    });

    it('multiple independent clients do not share state', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const clientA = makeClient();
      const clientB = makeClient();

      await clientA.runInScope(SCENARIO, 0, async () => {
        await clientA.complete(MESSAGES);
      });

      const usageB = await clientB.runInScope(SCENARIO, 0, async () => {
        return clientB.getAccumulatedUsage();
      });

      expect(usageB.calls).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // TrialLifecycle: runInScope interface compliance
  // ---------------------------------------------------------------------------
  describe('TrialLifecycle interface', () => {
    it('runInScope returns the function result', async () => {
      const client = makeClient();
      const result = await client.runInScope(SCENARIO, 0, async () => 42);
      expect(result).toBe(42);
    });

    it('runInScope propagates errors', async () => {
      const client = makeClient();
      await expect(
        client.runInScope(SCENARIO, 0, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
    });
  });

  // ---------------------------------------------------------------------------
  // IGocodeClient delegation
  // ---------------------------------------------------------------------------
  describe('complete() delegation', () => {
    it('returns the response content from the underlying client', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'delegated response' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
      const client = makeClient();

      const result = await client.runInScope(SCENARIO, 0, async () => {
        return client.complete(MESSAGES);
      });

      expect(result).toBe('delegated response');
    });

    it('propagates errors from underlying complete()', async () => {
      mockCreate.mockRejectedValue(new Error('API failure'));
      const client = makeClient();

      await expect(
        client.runInScope(SCENARIO, 0, () => client.complete(MESSAGES)),
      ).rejects.toThrow('API failure');
    });
  });

  describe('resetAccumulatedUsage()', () => {
    it('resets the per-trial instance counters', async () => {
      mockCreate.mockResolvedValue(USAGE_RESPONSE);
      const client = makeClient();

      await client.runInScope(SCENARIO, 0, async () => {
        await client.complete(MESSAGES);
        client.resetAccumulatedUsage();
        const usage = client.getAccumulatedUsage();
        expect(usage.calls).toBe(0);
        expect(usage.totalTokens).toBe(0);
      });
    });
  });
});
