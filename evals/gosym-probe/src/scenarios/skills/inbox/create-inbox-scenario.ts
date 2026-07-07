import { createPromptVsSkillScenario }
  from '../../prompt-vs-skill/create-prompt-vs-skill-scenario.js';
import { SkillSelectionEvaluator }
  from '../../../evaluators/skill-selection.js';
import { ExpectedArtifactMatchEvaluator }
  from '../../../evaluators/expected-artifact-match.js';
import { createNarrowArtifactJudge }
  from '../../../evaluators/narrow-artifact-judge.js';
import { createSkillOutcomeEvaluator }
  from '../../../evaluators/skill-outcome.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type {
  Scenario,
  ScenarioGoal,
  SkillInstruction,
  ExpectedArtifactSpec,
  ToolCallAssertion,
} from '../../types.js';
import type { Persona } from '../../../personas/types.js';
import type { Evaluator } from '../../../evaluators/evaluator.js';

export interface InboxScenarioConfig {
  name: string;
  goals: [ScenarioGoal, ...ScenarioGoal[]];
  skillInstructions: [SkillInstruction, ...SkillInstruction[]];
  persona?: Persona;
  trials?: number;
  expectedArtifact?: ExpectedArtifactSpec;
  expectedTools?: ToolCallAssertion[];
  extraEvaluators?: Evaluator[];
  staticFirstMessage: string;
}

export function createInboxScenario(
  config: InboxScenarioConfig,
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  if (config.trials !== undefined
    && (!Number.isFinite(config.trials) || config.trials <= 0)) {
    throw new RangeError(
      `[${config.name}] trials must be > 0, got ${config.trials}`,
    );
  }

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

  const extraEvaluators: Evaluator[] = [
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
      staticFirstMessage: config.staticFirstMessage,
      expectedSkills: ['inbox'],
      suite: 'inbox',
      skillInstructions: config.skillInstructions,
      expectedTools: config.expectedTools,
    },
    gocode,
    ctrlPlane,
  );
}
