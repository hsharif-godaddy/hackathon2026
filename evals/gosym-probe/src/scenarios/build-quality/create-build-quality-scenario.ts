import { standardPersona } from '../../personas/standard.js';
import { BugHitRateEvaluator }
  from '../../evaluators/bug-hit-rate.js';
import { PromptEfficiencyEvaluator }
  from '../../evaluators/prompt-efficiency.js';
import { JTBDCompletionEvaluator }
  from '../../evaluators/jtbd-completion.js';
import { OutputQualityEvaluator }
  from '../../evaluators/output-quality.js';
import { AgentStepsEvaluator }
  from '../../evaluators/agent-steps.js';
import { LatencyEvaluator }
  from '../../evaluators/latency-evaluator.js';
import { createTokenEvaluators }
  from '../../evaluators/create-token-evaluators.js';
import type { GocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario, ScenarioGoal }
  from '../types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator } from '../../evaluators/evaluator.js';

export interface BuildQualityConfig {
  // Required: always varies per scenario
  name: string;
  goals: [ScenarioGoal, ...ScenarioGoal[]];
  /** Upper bound on agent steps for AgentStepsEvaluator.
   *  Must be > 0 (zero causes NaN via 0/0 in the score formula).
   *  Should exceed maxTurns because multi-step agent behavior
   *  means total steps typically exceed total turns. */
  agentStepBudget: number;
  /** Max conversation turns before the simulation terminates.
   *  Must be > 0 (zero exits the simulation loop immediately). */
  maxTurns: number;

  // Optional with defaults
  staticFirstMessage?: string;
  persona?: Persona;
  suite?: string | null;
  category?: 'capability' | 'regression';
  trials?: number;
  extraEvaluators?: Evaluator[];
}

export function createBuildQualityScenario(
  config: BuildQualityConfig,
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  if (!Number.isFinite(config.agentStepBudget) || config.agentStepBudget <= 0) {
    throw new RangeError(
      `[${config.name}] agentStepBudget must be > 0, got ${config.agentStepBudget}`,
    );
  }
  if (!Number.isFinite(config.maxTurns) || config.maxTurns <= 0) {
    throw new RangeError(
      `[${config.name}] maxTurns must be > 0, got ${config.maxTurns}`,
    );
  }
  if (config.trials !== undefined
    && (!Number.isFinite(config.trials) || config.trials <= 0)) {
    throw new RangeError(
      `[${config.name}] trials must be > 0, got ${config.trials}`,
    );
  }
  const tokenEvaluators = createTokenEvaluators(gocode);
  return {
    name: config.name,
    suite: config.suite === null
      ? undefined
      : (config.suite ?? 'build-quality'),
    persona: config.persona ?? standardPersona,
    staticFirstMessage: config.staticFirstMessage,
    goals: config.goals,
    evaluators: [
      ...(config.extraEvaluators ?? []),
      new BugHitRateEvaluator(),
      new PromptEfficiencyEvaluator(),
      new JTBDCompletionEvaluator(gocode),
      new OutputQualityEvaluator(gocode),
      new AgentStepsEvaluator({ maxSteps: config.agentStepBudget }),
      new LatencyEvaluator(),
      ...tokenEvaluators,
    ],
    trials: config.trials ?? 3,
    executionMode: 'parallel',
    category: config.category ?? 'capability',
    maxTurns: config.maxTurns,

    setup: async () => {
      const { appId, previewUrl } =
        await ctrlPlane.provisionApp();
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      if (ctx.appId) {
        await ctrlPlane.deleteApp(ctx.appId);
      }
    },
  };
}
