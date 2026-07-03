import { createPromptVsSkillScenario } from './create-prompt-vs-skill-scenario.js';
import { publishFlowExpectation }
  from './expectations/publish-flow.expectation.js';
import { ExpectedArtifactMatchEvaluator }
  from '../../evaluators/expected-artifact-match.js';
import { DirectionalSignalEvaluator }
  from '../../evaluators/directional-signal.js';
import { createNarrowArtifactJudge }
  from '../../evaluators/narrow-artifact-judge.js';
import { SkillSelectionEvaluator }
  from '../../evaluators/skill-selection.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import { DEVELOP_AGENT_DISPLAY_NAME } from '../types.js';

export function multiTurnPublishFlowScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  calibrate: boolean = false,
): Scenario {
  return createPromptVsSkillScenario(
    {
      name: 'pvs-multi-turn-publish-flow',
      extraEvaluators: [
        new ExpectedArtifactMatchEvaluator(),
        new DirectionalSignalEvaluator(),
        new SkillSelectionEvaluator(),
      ],
      calibrationEvaluators: [createNarrowArtifactJudge(gocode)],
      calibrate,
      expectedArtifact: publishFlowExpectation,
      expectedAgent: DEVELOP_AGENT_DISPLAY_NAME,
      expectedSkills: ['publishing'],
      goals: [
        {
          description: 'Build a simple hello world site',
          assertion: 'positive',
        },
        {
          description: 'Publish the site to production',
          assertion: 'positive',
        },
        {
          description: 'Is it healthy?',
          assertion: 'positive',
        },
        {
          description: 'Publish the site to production again',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
