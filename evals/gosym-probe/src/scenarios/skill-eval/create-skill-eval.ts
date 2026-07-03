import { createPromptVsSkillScenario }
  from '../prompt-vs-skill/create-prompt-vs-skill-scenario.js';
import { SkillSelectionEvaluator }
  from '../../evaluators/skill-selection.js';
import { ExpectedArtifactMatchEvaluator }
  from '../../evaluators/expected-artifact-match.js';
import { createNarrowArtifactJudge }
  from '../../evaluators/narrow-artifact-judge.js';
import { createSkillOutcomeEvaluator }
  from '../../evaluators/skill-outcome.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type {
  Scenario,
  ScenarioGoal,
  SkillInstruction,
  ExpectedArtifactSpec,
  ToolCallAssertion,
} from '../types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator } from '../../evaluators/evaluator.js';
import type { StatefulAppOptions, SummarySeeder }
  from '../stateful/create-stateful-app.js';
import type { Claims } from '../types.js';

/**
 * Minimum trials for any skill-eval scenario. Skill selection is a
 * stochastic agent behavior: a single trial is a coin-flip read, and pass@1
 * cannot estimate a flaky failure rate. k=5 (the low-stability trial count)
 * is the floor at which pass^k reliability and a Wilson interval are
 * meaningful. Gating scenarios must never run at pass@1.
 */
export const SKILL_EVAL_MIN_TRIALS = 5;

export interface SkillEvalConfig {
  name: string;
  skill: string;
  userIntent: string;
  goals: [ScenarioGoal, ...ScenarioGoal[]];
  skillInstructions: [SkillInstruction, ...SkillInstruction[]];
  expectedArtifact?: ExpectedArtifactSpec;
  expectedAgent?: string;
  expectedTools?: ToolCallAssertion[];
  trials?: number;
  suite?: string;
  persona?: Persona;
  extraEvaluators?: Evaluator[];
  statefulInjection?: StatefulAppOptions;
  contextClaims?: Claims;
}

function validateConfig(config: SkillEvalConfig): void {
  if (!config.skill) {
    throw new Error(
      `[${config.name}] skill must be non-empty`,
    );
  }
  if (!config.userIntent) {
    throw new Error(
      `[${config.name}] userIntent must be non-empty`,
    );
  }
  if (config.trials !== undefined
    && (!Number.isInteger(config.trials) || config.trials <= 0)) {
    throw new RangeError(
      `[${config.name}] trials must be a positive integer, got ${config.trials}`,
    );
  }
  if (config.trials !== undefined && config.trials < SKILL_EVAL_MIN_TRIALS) {
    throw new RangeError(
      `[${config.name}] skill-eval scenarios require trials >= `
      + `${SKILL_EVAL_MIN_TRIALS} (pass@1 cannot estimate a stochastic `
      + `skill-selection failure rate); got ${config.trials}`,
    );
  }
  for (const instr of config.skillInstructions) {
    if (!instr.id || !instr.instruction) {
      throw new Error(
        `[${config.name}] each skillInstruction must have a non-empty id and instruction`,
      );
    }
  }
  // skill-outcome gates the verdict only on 'required' instructions; an
  // all-advisory list reduces to 'unknown', which eval-mode gating turns into
  // a false 'fail'. Require at least one required instruction so the evaluator
  // always has something to gate on.
  if (!config.skillInstructions.some((i) => i.priority === 'required')) {
    throw new Error(
      `[${config.name}] skillInstructions must include at least one 'required' `
      + `instruction (advisory-only cannot gate the skill-outcome verdict)`,
    );
  }
  const ids = config.skillInstructions.map((i) => i.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(
        `[${config.name}] duplicate skillInstruction ID: ${id}`,
      );
    }
    seen.add(id);
  }
}

export function createSkillEval(
  config: SkillEvalConfig,
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  seedSummary?: SummarySeeder,
): Scenario {
  validateConfig(config);

  const skillEvaluators: Evaluator[] = [
    // Skill-eval scenarios exist to gate on skill loading, so a run without
    // skill-load instrumentation is a broken gate — fail loud rather than
    // silently degrade to 'unknown' and fall back to the LLM judge alone.
    new SkillSelectionEvaluator({ requireSkillDiagnostics: true }),
    createSkillOutcomeEvaluator(gocode),
  ];

  if (config.expectedArtifact) {
    skillEvaluators.push(
      new ExpectedArtifactMatchEvaluator(),
      createNarrowArtifactJudge(gocode),
    );
  }

  const extraEvaluators = [
    ...skillEvaluators,
    ...(config.extraEvaluators ?? []),
  ];

  return createPromptVsSkillScenario(
    {
      name: config.name,
      goals: config.goals,
      persona: config.persona,
      trials: config.trials ?? SKILL_EVAL_MIN_TRIALS,
      extraEvaluators,
      staticFirstMessage: config.userIntent,
      expectedArtifact: config.expectedArtifact,
      expectedSkills: [config.skill],
      expectedAgent: config.expectedAgent,
      suite: config.suite ?? 'skill-eval',
      skillInstructions: config.skillInstructions,
      expectedTools: config.expectedTools,
      statefulInjection: config.statefulInjection,
      contextClaims: config.contextClaims,
    },
    gocode,
    ctrlPlane,
    seedSummary,
  );
}
