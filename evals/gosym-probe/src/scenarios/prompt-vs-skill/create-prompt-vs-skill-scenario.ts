import { beginnerPersona } from '../../personas/beginner.js';
import { BugHitRateEvaluator }
  from '../../evaluators/bug-hit-rate.js';
import { ToolFailureRateEvaluator }
  from '../../evaluators/tool-failure-rate.js';
import { PromptEfficiencyEvaluator }
  from '../../evaluators/prompt-efficiency.js';
import { ToolCallVerificationEvaluator }
  from '../../evaluators/tool-call-verification.js';
import { JTBDCompletionEvaluator }
  from '../../evaluators/jtbd-completion.js';
import { ToolParallelismEvaluator }
  from '../../evaluators/tool-parallelism.js';
import { TurnDurationEvaluator }
  from '../../evaluators/turn-duration.js';
import { createTokenEvaluators }
  from '../../evaluators/create-token-evaluators.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type {
  Scenario,
  ScenarioGoal,
  ExpectedArtifactSpec,
  SkillInstruction,
  ToolCallAssertion,
} from '../types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator } from '../../evaluators/evaluator.js';

export interface PromptVsSkillConfig {
  name: string;
  goals: [ScenarioGoal, ...ScenarioGoal[]];
  persona?: Persona;
  trials?: number;
  extraEvaluators?: Evaluator[];
  staticFirstMessage?: string;
  /**
   * Static-rigor expectations, set declaratively so the scenario carries
   * them at construction time (no post-build mutation, which silently
   * leaves the skill-selection evaluator reporting 'unknown' if it runs
   * before the field is assigned).
   */
  expectedArtifact?: ExpectedArtifactSpec;
  expectedSkills?: string[];
  expectedAgent?: string;
  suite?: string;
  skillInstructions?: SkillInstruction[];
  expectedTools?: ToolCallAssertion[];
  /**
   * Evaluators included ONLY under --calibrate (the narrow LLM judge is
   * the canonical one): expensive, calibration-time signals that the
   * deterministic layer is checked against, not run on every eval.
   */
  calibrationEvaluators?: Evaluator[];
  calibrate?: boolean;
}

export function createPromptVsSkillScenario(
  config: PromptVsSkillConfig,
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
  const calibrationEvaluators = config.calibrate
    ? (config.calibrationEvaluators ?? [])
    : [];
  const allEvaluators = [
    ...(config.extraEvaluators ?? []),
    ...calibrationEvaluators,
    ...builtinEvaluators,
  ];
  const names = allEvaluators.map((e) => e.name);
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicates.length > 0) {
    throw new Error(
      `[${config.name}] duplicate evaluator name(s): ${[...new Set(duplicates)].join(', ')}`,
    );
  }

  return {
    name: config.name,
    suite: config.suite ?? 'prompt-vs-skill',
    persona: config.persona ?? beginnerPersona,
    goals: config.goals,
    evaluators: allEvaluators,
    expectedArtifact: config.expectedArtifact,
    expectedSkills: config.expectedSkills,
    expectedAgent: config.expectedAgent,
    skillInstructions: config.skillInstructions,
    expectedTools: config.expectedTools,
    staticFirstMessage: config.staticFirstMessage,
    trials: config.trials ?? 1,

    setup: async () => {
      const { appId, previewUrl } = await ctrlPlane.provisionApp();
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
