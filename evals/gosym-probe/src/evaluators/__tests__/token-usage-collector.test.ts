import { describe, it, expect, vi } from 'vitest';
import { TokenUsageCollector } from '../token-usage-collector.js';
import type {
  AgentClient,
  AgentEvent,
} from '../../clients/agent-client.js';

function makeMockClient(): {
  client: AgentClient;
  fire: (event: AgentEvent) => void;
} {
  const handlers: ((event: AgentEvent) => void)[] = [];
  const client: AgentClient = {
    configure: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
    onMessage(handler) {
      handlers.push(handler);
    },
  };
  return {
    client,
    fire: (event) => handlers.forEach((h) => h(event)),
  };
}

function makeTokenEvent(
  overrides: Partial<
    Omit<AgentEvent & { type: 'token_usage_summary' }, 'type'>
  > = {},
): AgentEvent {
  return {
    type: 'token_usage_summary',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cachedInputTokensRead: 10,
    cachedInputTokensWrite: 5,
    modelName: 'claude-sonnet-4-6',
    totalCost: 0.01,
    inputCost: 0.006,
    outputCost: 0.004,
    cachedInputCost: 0.0005,
    savings: 0.002,
    currency: 'USD',
    ...overrides,
  };
}

describe('TokenUsageCollector', () => {
  describe('hook / collect lifecycle', () => {
    it('returns collected data after hooking and firing an event', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire(makeTokenEvent());

      const data = collector.collect(0);
      expect(data).not.toBeNull();
      expect(data?.inputTokens).toBe(100);
      expect(data?.outputTokens).toBe(50);
      expect(data?.totalTokens).toBe(150);
      expect(data?.cachedInputTokensRead).toBe(10);
      expect(data?.cachedInputTokensWrite).toBe(5);
      expect(data?.totalCost).toBeCloseTo(0.01);
      expect(data?.inputCost).toBeCloseTo(0.006);
      expect(data?.outputCost).toBeCloseTo(0.004);
      expect(data?.cachedInputCost).toBeCloseTo(0.0005);
      expect(data?.savings).toBeCloseTo(0.002);
      expect(data?.currency).toBe('USD');
      expect(data?.lastModelName).toBe('claude-sonnet-4-6');
      expect(data?.eventCount).toBe(1);
    });

    it('returns null when hook was never called', () => {
      const collector = new TokenUsageCollector();
      expect(collector.collect(0)).toBeNull();
    });

    it('returns same data on repeated collect (non-destructive)', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire(makeTokenEvent());

      const first = collector.collect(0);
      const second = collector.collect(0);
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second?.inputTokens).toBe(first?.inputTokens);
      expect(second?.totalTokens).toBe(first?.totalTokens);
    });
  });

  describe('idempotent hook', () => {
    it('does not throw when hook is called twice for the same trial', () => {
      const collector = new TokenUsageCollector();
      const { client } = makeMockClient();

      expect(() => {
        collector.hook(client, 0);
        collector.hook(client, 0);
      }).not.toThrow();
    });

    it('does not double-count events when hook is called twice', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      collector.hook(client, 0);
      fire(makeTokenEvent({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }));

      const data = collector.collect(0);
      expect(data?.inputTokens).toBe(200);
      expect(data?.outputTokens).toBe(100);
      expect(data?.totalTokens).toBe(300);
      expect(data?.eventCount).toBe(1);
    });
  });

  describe('multi-trial isolation', () => {
    it('keeps trial 0 and trial 1 data separate', () => {
      const collector = new TokenUsageCollector();
      const mock0 = makeMockClient();
      const mock1 = makeMockClient();

      collector.hook(mock0.client, 0);
      collector.hook(mock1.client, 1);

      mock0.fire(makeTokenEvent({ inputTokens: 100, totalTokens: 100 }));
      mock1.fire(makeTokenEvent({ inputTokens: 200, totalTokens: 200 }));

      const data0 = collector.collect(0);
      const data1 = collector.collect(1);

      expect(data0?.inputTokens).toBe(100);
      expect(data1?.inputTokens).toBe(200);
    });

    it('events fired on trial 0 client do not appear in trial 1', () => {
      const collector = new TokenUsageCollector();
      const mock0 = makeMockClient();
      const mock1 = makeMockClient();

      collector.hook(mock0.client, 0);
      collector.hook(mock1.client, 1);

      mock0.fire(makeTokenEvent({ inputTokens: 999 }));
      // fire nothing on mock1

      expect(collector.collect(1)?.inputTokens).toBe(0);
    });
  });

  describe('post-unhook event handling', () => {
    it('events arriving after unhook() are silently dropped', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire(makeTokenEvent({ inputTokens: 100 }));
      collector.unhook(0);

      // Events fired after unhook must not throw and must not mutate deleted data
      expect(() => fire(makeTokenEvent({ inputTokens: 999 }))).not.toThrow();
      expect(collector.collect(0)).toBeNull();
    });
  });

  describe('collect() isolation', () => {
    it('returns a copy, not the live internal object', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire(makeTokenEvent({ inputTokens: 100 }));

      const copy = collector.collect(0)!;
      copy.inputTokens = 9999;

      const fresh = collector.collect(0)!;
      expect(fresh.inputTokens).toBe(100);
    });
  });

  describe('unhook cleanup', () => {
    it('returns null after unhook', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire(makeTokenEvent());
      collector.unhook(0);

      expect(collector.collect(0)).toBeNull();
    });

    it('is idempotent when called on a trial that was never hooked', () => {
      const collector = new TokenUsageCollector();
      expect(() => collector.unhook(99)).not.toThrow();
    });

    it('is idempotent when called twice', () => {
      const collector = new TokenUsageCollector();
      const { client } = makeMockClient();

      collector.hook(client, 0);
      expect(() => {
        collector.unhook(0);
        collector.unhook(0);
      }).not.toThrow();
    });
  });

  describe('accumulation across multiple events', () => {
    it('sums numeric fields from multiple token_usage_summary events', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire(makeTokenEvent({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokensRead: 10,
        cachedInputTokensWrite: 5,
        totalCost: 0.01,
        inputCost: 0.006,
        outputCost: 0.004,
        cachedInputCost: 0.0005,
        savings: 0.002,
      }));
      fire(makeTokenEvent({
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
        cachedInputTokensRead: 20,
        cachedInputTokensWrite: 8,
        totalCost: 0.02,
        inputCost: 0.012,
        outputCost: 0.008,
        cachedInputCost: 0.001,
        savings: 0.004,
      }));

      const data = collector.collect(0);
      expect(data?.inputTokens).toBe(300);
      expect(data?.outputTokens).toBe(130);
      expect(data?.totalTokens).toBe(430);
      expect(data?.cachedInputTokensRead).toBe(30);
      expect(data?.cachedInputTokensWrite).toBe(13);
      expect(data?.totalCost).toBeCloseTo(0.03);
      expect(data?.inputCost).toBeCloseTo(0.018);
      expect(data?.outputCost).toBeCloseTo(0.012);
      expect(data?.cachedInputCost).toBeCloseTo(0.0015);
      expect(data?.savings).toBeCloseTo(0.006);
      expect(data?.eventCount).toBe(2);
    });

    it('uses lastModelName and currency from the last event', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire(makeTokenEvent({ modelName: 'model-a', currency: 'USD' }));
      fire(makeTokenEvent({ modelName: 'model-b', currency: 'USD' }));

      const data = collector.collect(0);
      expect(data?.lastModelName).toBe('model-b');
      expect(data?.currency).toBe('USD');
    });

    it('ignores non-token_usage_summary events', () => {
      const collector = new TokenUsageCollector();
      const { client, fire } = makeMockClient();

      collector.hook(client, 0);
      fire({ type: 'chunk', content: 'hello' });
      fire({ type: 'complete', content: 'done' });
      fire(makeTokenEvent({ inputTokens: 42 }));

      const data = collector.collect(0);
      expect(data?.inputTokens).toBe(42);
      expect(data?.eventCount).toBe(1);
    });

    it('returns zero-valued data when hook is called but no events fired', () => {
      const collector = new TokenUsageCollector();
      const { client } = makeMockClient();

      collector.hook(client, 0);

      const data = collector.collect(0);
      expect(data).not.toBeNull();
      expect(data?.inputTokens).toBe(0);
      expect(data?.totalTokens).toBe(0);
      expect(data?.totalCost).toBe(0);
      expect(data?.eventCount).toBe(0);
    });
  });
});
