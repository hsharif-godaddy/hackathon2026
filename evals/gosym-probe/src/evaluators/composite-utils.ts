import type { AgentClient } from '../clients/agent-client.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { EvalResult, Evaluator } from './evaluator.js';

export abstract class CompositeEvaluatorBase {
  protected readonly subEvaluators: Evaluator[];

  constructor(subEvaluators: Evaluator[]) {
    this.subEvaluators = subEvaluators;
  }

  hookClient(client: AgentClient, trialIndex: number): void {
    for (const ev of this.subEvaluators) {
      ev.hookClient?.(client, trialIndex);
    }
  }

  afterSimulation(trialIndex: number): void {
    for (const ev of this.subEvaluators) {
      ev.afterSimulation?.(trialIndex);
    }
  }

  unhookTrial(trialIndex: number): void {
    for (const ev of this.subEvaluators) {
      ev.unhookTrial?.(trialIndex);
    }
  }
}

export interface CompositeBreakdownEntry {
  evaluator: string;
  score: number;
  verdict: EvalResult['verdict'];
  reason: string;
  scoreable: boolean;
  evaluatorFailed?: boolean;
}

export async function safeEvaluate(
  evaluator: Evaluator,
  transcript: Transcript,
  scenario: Scenario,
  snapshot: DOMSnapshot | undefined,
): Promise<EvalResult> {
  try {
    return await evaluator.evaluate(transcript, scenario, snapshot);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[safeEvaluate] sub-evaluator threw', { evaluator: evaluator.name, reason }, err);
    return {
      evaluator: evaluator.name,
      score: 0,
      verdict: 'fail',
      reason: `Sub-evaluator threw: ${reason}`,
      evaluatorFailed: true,
    };
  }
}
