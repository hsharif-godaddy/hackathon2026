import { vi } from 'vitest';
import type {
  TokenUsageCollector,
  TrialTokenData,
} from '../token-usage-collector.js';
import type {
  ProbeUsage,
  ProbeUsageSource,
} from '../../clients/gocode-client.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Transcript } from '../../runner/transcript.js';
import type { AgentClient } from '../../clients/agent-client.js';
import type { Persona } from '../../personas/types.js';

export const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

export function makeScenario(
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 1,
    category: 'capability',
    ...overrides,
  };
}

export function makeTranscript(trialIndex: number): Transcript {
  return {
    scenarioName: 'test',
    trialIndex,
    turns: [],
    snapshots: [],
    errors: [],
  };
}

export function makeTrialTokenData(
  overrides: Partial<TrialTokenData> = {},
): TrialTokenData {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cachedInputTokensRead: 0,
    cachedInputTokensWrite: 0,
    totalCost: 0.05,
    inputCost: 0.03,
    outputCost: 0.02,
    cachedInputCost: 0.0,
    savings: 0.0,
    currency: 'USD',
    lastModelName: 'claude-sonnet-4-6',
    eventCount: 1,
    ...overrides,
  };
}

/**
 * Mutable mock ProbeUsageSource. Call setUsage() to
 * advance the accumulated state between hookClient and evaluate.
 */
export function makeMockGocodeClient(
  initial: Partial<ProbeUsage> = {},
): ProbeUsageSource & { setUsage(u: Partial<ProbeUsage>): void } {
  let usage: ProbeUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
    ...initial,
  };
  return {
    getAccumulatedUsage: vi.fn(() => ({ ...usage })),
    setUsage(u: Partial<ProbeUsage>) {
      usage = { ...usage, ...u };
    },
  };
}

export function makeMockCollector(
  collectReturn: TrialTokenData | null = null,
): TokenUsageCollector {
  return {
    hook: vi.fn(),
    collect: vi.fn().mockReturnValue(collectReturn),
    unhook: vi.fn(),
  } as unknown as TokenUsageCollector;
}

export function makeMockClient(): AgentClient {
  return {
    configure: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(),
  };
}
