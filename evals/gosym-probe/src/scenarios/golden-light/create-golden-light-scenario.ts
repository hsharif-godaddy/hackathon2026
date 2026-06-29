import { standardPersona } from '../../personas/standard.js';
import { BugHitRateEvaluator }
  from '../../evaluators/bug-hit-rate.js';
import { ToolFailureRateEvaluator }
  from '../../evaluators/tool-failure-rate.js';
import { PromptEfficiencyEvaluator }
  from '../../evaluators/prompt-efficiency.js';
import { JTBDCompletionEvaluator }
  from '../../evaluators/jtbd-completion.js';
import {
  createGoldenLightEvaluators,
  createAlignmentLLMEvaluators,
} from '../../evaluators/golden-light-evaluators/index.js';
import { AgentStepsEvaluator }
  from '../../evaluators/agent-steps.js';
import { LatencyEvaluator }
  from '../../evaluators/latency-evaluator.js';
import { ToolParallelismEvaluator }
  from '../../evaluators/tool-parallelism.js';
import { ToolBatchingEfficiencyEvaluator }
  from '../../evaluators/tool-batching-efficiency.js';
import { TurnDurationEvaluator }
  from '../../evaluators/turn-duration.js';
import { TokenUsageCollector }
  from '../../evaluators/token-usage-collector.js';
import { TokenUsageEvaluator }
  from '../../evaluators/token-usage.js';

import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario, ScenarioGoal, ExpectedArtifactSpec }
  from '../types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator } from '../../evaluators/evaluator.js';
import { createStatefulApp } from '../stateful/create-stateful-app.js';
import type { StatefulAppOptions, SummarySeeder } from '../stateful/create-stateful-app.js';


export interface GoldenLightConfig {
  name: string;
  agentProfile?: string;
  goals: [ScenarioGoal, ...ScenarioGoal[]];

  staticFirstMessage?: string;
  /**
   * Prefab chat history (stateful injection, half 1): a fixed ordered list of
   * verbatim user messages replayed with no LLM call. Supersedes
   * staticFirstMessage. See Scenario.scriptedTurns.
   */
  scriptedTurns?: string[];
  /** End the conversation once scriptedTurns is exhausted. See Scenario. */
  scriptEndsConversation?: boolean;
  persona?: Persona;
  suite?: string | null;
  trials?: number;
  extraEvaluators?: Evaluator[];
  /**
   * Static-rigor expectations, set declaratively so the scenario carries
   * them at construction time (no post-build mutation, which silently
   * leaves the skill-selection evaluator reporting 'unknown' if it runs
   * before the field is assigned).
   */
  expectedArtifact?: ExpectedArtifactSpec;
  expectedSkills?: string[];
  expectedAgent?: string;
  /**
   * Evaluators included ONLY under --calibrate (the narrow LLM judge is
   * the canonical one): expensive, calibration-time signals that the
   * deterministic layer is checked against, not run on every eval.
   */
  calibrationEvaluators?: Evaluator[];
  calibrate?: boolean;
  /**
   * Opt into stateful injection: reuse one provisioned app across all trials,
   * resetting its workspace between trials, instead of provisioning a fresh app
   * per trial. Reduces per-trial build variance. Pair with `scriptedTurns` for
   * a fully-deterministic starting state. When set, the per-trial `setup`/
   * `teardown` are the shared-app variants and the app is deleted once after the
   * suite via the lifecycle's `teardownShared`.
   *
   * Requires serial trials (--concurrency 1): the shared app cannot be safely
   * reset while concurrent trials build against it. The runner enforces this.
   */
  statefulInjection?: StatefulAppOptions;
}

export function createGoldenLightScenario(
  config: GoldenLightConfig,
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
  // scriptedTurns silently supersedes staticFirstMessage via decorator
  // ordering; setting both is a misconfiguration, so fail loud rather than let
  // the ignored field read as effective.
  if (config.scriptedTurns?.length && config.staticFirstMessage) {
    throw new Error(
      `[${config.name}] scriptedTurns supersedes staticFirstMessage; set one, not both`,
    );
  }
  const collector = new TokenUsageCollector();
  const builtinEvaluators = [
    new BugHitRateEvaluator(),
    new ToolFailureRateEvaluator(),
    new PromptEfficiencyEvaluator(),
    new JTBDCompletionEvaluator(gocode),
    ...createGoldenLightEvaluators(gocode),
    new AgentStepsEvaluator(),
    new LatencyEvaluator(),
    new ToolParallelismEvaluator(),
    new ToolBatchingEfficiencyEvaluator(),
    new TurnDurationEvaluator(),
    new TokenUsageEvaluator({ collector, gocodeClient: gocode }),
    ...createAlignmentLLMEvaluators(gocode),
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
  // Stateful injection reuses one app across trials; otherwise each trial
  // provisions and tears down its own. The shared-app deletion can't hang off
  // per-trial teardown (it would kill the app mid-suite), and there is no
  // scenario-level teardown hook, so it runs once on process exit. The control
  // plane's reconciler reaps the app as a backstop if the process is killed.
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
    process.once('beforeExit', () => void teardownShared());
    // beforeExit does NOT fire on Ctrl+C / kill — the most common ways an eval
    // run is stopped — so the shared app would leak until the control plane's
    // reconciler reaps it. Fire the (best-effort, idempotent) teardown on the
    // termination signals too, awaiting the delete before re-exiting with the
    // conventional 128+signo so the HTTP call actually lands and the process
    // still terminates as the signal intended.
    for (const [signal, signo] of [['SIGINT', 2], ['SIGTERM', 15]] as const) {
      process.once(signal, () => {
        void teardownShared().finally(() => process.exit(128 + signo));
      });
    }
  }

  return {
    name: config.name,
    suite: config.suite === null
      ? undefined
      : (config.suite ?? 'golden-light'),
    persona: config.persona ?? standardPersona,
    agentProfile: config.agentProfile ?? undefined,
    staticFirstMessage: config.staticFirstMessage,
    scriptedTurns: config.scriptedTurns,
    scriptEndsConversation: config.scriptEndsConversation,
    goals: config.goals,
    evaluators: allEvaluators,
    expectedArtifact: config.expectedArtifact,
    expectedSkills: config.expectedSkills,
    expectedAgent: config.expectedAgent,
    trials: config.trials ?? 3,
    // Stateful injection shares one app across trials → trials must be serial.
    ...(lifecycle && { requiresSerialTrials: true }),

    setup: lifecycle
      ? lifecycle.setup
      : async () => {
        const { appId, previewUrl } =
          await ctrlPlane.provisionApp();
        return { appId, previewUrl };
      },

    teardown: lifecycle
      ? lifecycle.teardown
      : async (ctx) => {
        if (ctx.appId) {
          await ctrlPlane.deleteApp(ctx.appId);
        }
      },
  };
}
