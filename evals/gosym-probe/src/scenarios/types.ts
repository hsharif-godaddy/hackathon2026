import type { Evaluator } from '../evaluators/evaluator.js';
import type { DOMSnapshot } from '../runner/transcript.js';
import type { Persona } from '../personas/types.js';
import type { AgentClient } from '../clients/agent-client.js';

export interface SetupContext {
  appId?: string;
  previewUrl?: string;
  [key: string]: unknown;
}

export type StabilityLevel = 'low' | 'medium' | 'high';

export const DEFAULT_STABILITY_LEVEL: StabilityLevel = 'low';

export const STABILITY_TRIALS: Record<StabilityLevel, number> = {
  low: 3,
  medium: 5,
  high: 10,
};

export function resolveStabilityLevel(
  override: StabilityLevel | undefined,
  scenario: Pick<Scenario, 'stabilityLevel'>,
): StabilityLevel {
  return override ?? scenario.stabilityLevel ?? DEFAULT_STABILITY_LEVEL;
}

export interface ScenarioGoal {
  description: string;
  assertion: 'positive' | 'negative';
}

export interface ToolCallAssertion {
  tool: string;
  called: boolean;
  match?: 'exact' | 'prefix';
  toolPattern?: RegExp;
}

export interface Scenario {
  name: string;
  suite?: string;
  persona: Persona;
  agentProfile?: string;
  goals: ScenarioGoal[];
  evaluators: Evaluator[];
  trials: number;
  stabilityLevel?: StabilityLevel;
  referenceSolution?: string | DOMSnapshot;
  expectedTools?: ToolCallAssertion[];
  setup?: () => Promise<SetupContext | void>;
  teardown?: (ctx: SetupContext) => Promise<void>;
  /**
   * When set, the synthetic user sends this text
   * verbatim on the first turn instead of generating a
   * message via the GoCode LLM. Use for scenarios that
   * require a fixed, reproducible prompt.
   *
   * Single-turn only. Multi-turn scripted conversations
   * would require a staticMessages array or a
   * ScriptedSyntheticUser strategy.
   */
  staticFirstMessage?: string;
  /**
   * Called with the agent client immediately before each
   * trial's simulation starts. Use for non-evaluator
   * per-trial hooks. Evaluator hooks should use
   * Evaluator.hookClient() instead (called automatically
   * by SuiteRunner).
   */
  beforeTrial?: (
    client: AgentClient,
    trialIndex: number,
  ) => void;
}
