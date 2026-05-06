// Accumulates AAB token_usage_summary events per trial; shared by TokenUsageEvaluator and LLMCostEvaluator.
import type { AgentClient } from '../clients/agent-client.js';

export interface TrialTokenData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokensRead: number;
  cachedInputTokensWrite: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cachedInputCost: number;
  savings: number;
  currency: string;
  lastModelName: string;
  /** Number of token_usage_summary events accumulated. */
  eventCount: number;
}

const ZERO_TRIAL_DATA = (): TrialTokenData => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokensRead: 0,
  cachedInputTokensWrite: 0,
  totalCost: 0,
  inputCost: 0,
  outputCost: 0,
  cachedInputCost: 0,
  savings: 0,
  currency: 'USD',
  lastModelName: '',
  eventCount: 0,
});

// Registers per-trial listeners and accumulates token_usage_summary data.
export class TokenUsageCollector {
  private readonly trials = new Map<number, TrialTokenData>();

  // Register a token_usage_summary listener; idempotent per trial.
  hook(client: AgentClient, trialIndex: number): void {
    if (this.trials.has(trialIndex)) {
      return;
    }

    this.trials.set(trialIndex, ZERO_TRIAL_DATA());

    client.onMessage((event) => {
      if (event.type !== 'token_usage_summary') return;
      const trial = this.trials.get(trialIndex);
      if (!trial) return;
      trial.inputTokens += event.inputTokens;
      trial.outputTokens += event.outputTokens;
      trial.totalTokens += event.totalTokens;
      trial.cachedInputTokensRead += event.cachedInputTokensRead;
      trial.cachedInputTokensWrite += event.cachedInputTokensWrite;
      trial.totalCost += event.totalCost;
      trial.inputCost += event.inputCost;
      trial.outputCost += event.outputCost;
      trial.cachedInputCost += event.cachedInputCost;
      trial.savings += event.savings;
      trial.currency = event.currency;
      trial.lastModelName = event.modelName;
      trial.eventCount += 1;
    });
  }

  // Returns a snapshot copy for a trial, or null if hook() was never called.
  collect(trialIndex: number): TrialTokenData | null {
    const data = this.trials.get(trialIndex);
    return data ? { ...data } : null;
  }

  // Idempotent cleanup; removes the trial entry from the map.
  unhook(trialIndex: number): void {
    this.trials.delete(trialIndex);
  }
}
