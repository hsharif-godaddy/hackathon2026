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
  Claims,
} from '../types.js';
import type { Persona } from '../../personas/types.js';
import type { Evaluator } from '../../evaluators/evaluator.js';

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
    && (!Number.isFinite(config.trials) || config.trials <= 0)) {
    throw new RangeError(
      `[${config.name}] trials must be > 0, got ${config.trials}`,
    );
  }
  for (const instr of config.skillInstructions) {
    if (!instr.id || !instr.instruction) {
      throw new Error(
        `[${config.name}] each skillInstruction must have a non-empty id and instruction`,
      );
    }
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
): Scenario {
  validateConfig(config);

  const skillEvaluators: Evaluator[] = [
    new SkillSelectionEvaluator(),
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
      trials: config.trials,
      extraEvaluators,
      staticFirstMessage: config.userIntent,
      expectedArtifact: config.expectedArtifact,
      expectedSkills: [config.skill],
      expectedAgent: config.expectedAgent,
      suite: config.suite ?? 'skill-eval',
      skillInstructions: config.skillInstructions,
      expectedTools: config.expectedTools,
      contextClaims: config.contextClaims,
    },
    gocode,
    ctrlPlane,
  );
}
