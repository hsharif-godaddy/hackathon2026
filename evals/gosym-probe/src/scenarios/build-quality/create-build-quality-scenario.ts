import { standardPersona } from '../../personas/standard.js';
import { BugHitRateEvaluator }
  from '../../evaluators/bug-hit-rate.js';
import { ToolFailureRateEvaluator }
  from '../../evaluators/tool-failure-rate.js';
import { PromptEfficiencyEvaluator }
  from '../../evaluators/prompt-efficiency.js';
import { JTBDCompletionEvaluator }
  from '../../evaluators/jtbd-completion.js';
import { createBuildQualityEvaluators }
  from '../../evaluators/build-quality-evaluators/index.js';
import { AgentStepsEvaluator }
  from '../../evaluators/agent-steps.js';
import { LatencyEvaluator }
  from '../../evaluators/latency-evaluator.js';
import { ToolParallelismEvaluator }
  from '../../evaluators/tool-parallelism.js';
import { TurnDurationEvaluator }
  from '../../evaluators/turn-duration.js';
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

  // Optional with defaults
  staticFirstMessage?: string;
  persona?: Persona;
  suite?: string | null;
  trials?: number;
  extraEvaluators?: Evaluator[];
}

export function createBuildQualityScenario(
  config: BuildQualityConfig,
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  if (config.trials !== undefined
    && (!Number.isFinite(config.trials) || config.trials <= 0)) {
    throw new RangeError(
      `[${config.name}] trials must be > 0, got ${config.trials}`,
    );
  }
  const tokenEvaluators = createTokenEvaluators(gocode);
  const builtinEvaluators = [
    new BugHitRateEvaluator(),
    new ToolFailureRateEvaluator(),
    new PromptEfficiencyEvaluator(),
    new JTBDCompletionEvaluator(gocode),
    ...createBuildQualityEvaluators(gocode),
    new AgentStepsEvaluator(),
    new LatencyEvaluator(),
    new ToolParallelismEvaluator(),
    new TurnDurationEvaluator(),
    ...tokenEvaluators,
  ];
  const allEvaluators = [...(config.extraEvaluators ?? []), ...builtinEvaluators];
  const names = allEvaluators.map((e) => e.name);
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicates.length > 0) {
    throw new Error(
      `[${config.name}] duplicate evaluator name(s): ${[...new Set(duplicates)].join(', ')}`,
    );
  }
  return {
    name: config.name,
    suite: config.suite === null
      ? undefined
      : (config.suite ?? 'build-quality'),
    persona: config.persona ?? standardPersona,
    staticFirstMessage: config.staticFirstMessage,
    goals: config.goals,
    evaluators: allEvaluators,
    trials: config.trials ?? 3,
    executionMode: 'parallel',

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
