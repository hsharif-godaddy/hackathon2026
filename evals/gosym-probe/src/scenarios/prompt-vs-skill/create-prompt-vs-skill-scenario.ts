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
  Claims,
} from '../types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator } from '../../evaluators/evaluator.js';
import { createStatefulApp } from '../stateful/create-stateful-app.js';
import type { StatefulAppOptions, SummarySeeder }
  from '../stateful/create-stateful-app.js';

const statefulTeardowns = new Set<() => Promise<void>>();
let handlersRegistered = false;

function registerSharedHandlersOnce(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  process.setMaxListeners(Math.max(process.getMaxListeners(), 20));
  process.once('beforeExit', (): void => {
    void Promise.all([...statefulTeardowns].map((fn) => fn()));
  });
  for (const [signal, signo] of [['SIGINT', 2], ['SIGTERM', 15]] as const) {
    process.once(signal, (): void => {
      void Promise.all([...statefulTeardowns].map((fn) => fn()))
        .finally(() => process.exit(128 + signo));
    });
  }
}

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
  /** Per-request switchboard claims minted into the scenario's mock JWT. */
  contextClaims?: Claims;
  /**
   * Evaluators included ONLY under --calibrate (the narrow LLM judge is
   * the canonical one): expensive, calibration-time signals that the
   * deterministic layer is checked against, not run on every eval.
   */
  calibrationEvaluators?: Evaluator[];
  calibrate?: boolean;
  /**
   * Opt into stateful injection: reuse one provisioned app across all trials,
   * resetting its workspace between trials. Requires serial trials. When set,
   * the per-trial setup/teardown are the shared-app variants; teardown of the
   * shared app runs on process exit via beforeExit/SIGINT/SIGTERM handlers.
   */
  statefulInjection?: StatefulAppOptions;
}

export function createPromptVsSkillScenario(
  config: PromptVsSkillConfig,
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  seedSummary?: SummarySeeder,
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

  const lifecycle = config.statefulInjection
    ? createStatefulApp(ctrlPlane, config.statefulInjection, seedSummary)
    : undefined;

  if (lifecycle) {
    let sharedTornDown = false;
    const teardownShared = async (): Promise<void> => {
      if (sharedTornDown) return;
      sharedTornDown = true;
      try {
        await lifecycle.teardownShared();
      } catch (err: unknown) {
        // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
        console.warn(
          '[%s] shared-app teardown failed:',
          config.name,
          err instanceof Error ? err.message : String(err),
        );
      }
    };
    statefulTeardowns.add(teardownShared);
    registerSharedHandlersOnce();
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
    contextClaims: config.contextClaims,
    staticFirstMessage: config.staticFirstMessage,
    trials: config.trials ?? 1,
    ...(lifecycle && { requiresSerialTrials: true }),

    setup: lifecycle
      ? lifecycle.setup
      : async () => {
        const { appId, previewUrl } = await ctrlPlane.provisionApp();
        return { appId, previewUrl };
      },

    teardown: lifecycle
      ? lifecycle.teardown
      : async (ctx) => {
        const appId = ctx.appId;
        if (appId) {
          await ctrlPlane.deleteApp(appId);
        }
      },
  };
}
