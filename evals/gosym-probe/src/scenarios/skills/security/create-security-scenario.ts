import { beginnerPersona } from '../../../personas/beginner.js';
import { BugHitRateEvaluator }
  from '../../../evaluators/bug-hit-rate.js';
import { ToolFailureRateEvaluator }
  from '../../../evaluators/tool-failure-rate.js';
import { PromptEfficiencyEvaluator }
  from '../../../evaluators/prompt-efficiency.js';
import { ToolCallVerificationEvaluator }
  from '../../../evaluators/tool-call-verification.js';
import { JTBDCompletionEvaluator }
  from '../../../evaluators/jtbd-completion.js';
import { ToolParallelismEvaluator }
  from '../../../evaluators/tool-parallelism.js';
import { TurnDurationEvaluator }
  from '../../../evaluators/turn-duration.js';
import { createTokenEvaluators }
  from '../../../evaluators/create-token-evaluators.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario, ScenarioGoal, ToolCallAssertion }
  from '../../types.js';
import type { Persona } from '../../../personas/types.js';
import type { Evaluator } from '../../../evaluators/evaluator.js';

export interface SecurityScenarioConfig {
  name: string;
  goals: [ScenarioGoal, ...ScenarioGoal[]];
  persona?: Persona;
  trials?: number;
  expectedTools?: ToolCallAssertion[];
  extraEvaluators?: Evaluator[];
  staticFirstMessage?: string;
  /** Called after provisioning to seed the app with test state (e.g. vulnerable files). */
  afterProvision?: (appId: string) => Promise<void>;
}

export function createSecurityScenario(
  config: SecurityScenarioConfig,
  gocode: IGocodeClient,
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
    new ToolCallVerificationEvaluator(),
    new JTBDCompletionEvaluator(gocode),
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
    suite: 'security',
    persona: config.persona ?? beginnerPersona,
    goals: config.goals,
    evaluators: allEvaluators,
    expectedTools: config.expectedTools,
    staticFirstMessage: config.staticFirstMessage,
    trials: config.trials ?? 3,

    setup: async () => {
      const { appId, previewUrl } = await ctrlPlane.provisionApp();
      if (config.afterProvision) {
        await config.afterProvision(appId);
      }
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      const appId = ctx.appId;
      if (appId) {
        await ctrlPlane.deleteApp(appId);
      }
    },
  };
}
