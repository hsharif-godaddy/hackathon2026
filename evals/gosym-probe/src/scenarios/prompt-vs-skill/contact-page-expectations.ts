import { createPromptVsSkillScenario } from './create-prompt-vs-skill-scenario.js';
import { contactPageExpectation } from './expectations/contact-page.expectation.js';
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

/**
 * Pilot scenario demonstrating the static-analysis rigor layer:
 * - expected-artifact-match (deterministic CheckList over the build)
 * - narrow-artifact-judge (LLM, same checklist) — the pair the
 *   Signal Disagreements report compares
 * - skill-selection (routing via agentId today; skill-load in true
 *   mode when SKILL_DIAGNOSTICS is on, else 'unknown' proxy mode)
 *
 * Uses a fixed first message (staticFirstMessage) so the build prompt
 * is reproducible across trials. expectedAgent is the develop agent,
 * which owns build work in AAB. The agentId on tool calls is the
 * agent's DISPLAY name ('AI Developer'), not a slug — confirmed from a
 * real run (run 939dc1f0): tool calls carried 'Initial' then
 * 'AI Developer'.
 *
 * expectedSkills asserts the agent loads the 'inbox' skill — AAB's
 * contact/messaging capability for "a way for visitors to contact me."
 * Confirmed loaded in run e1ceb8d5 (loadedSkills: ['media-logo',
 * 'inbox']). This exercises skill-selection's TRUE-mode skill-load
 * assertion when SKILL_DIAGNOSTICS=true; with instrumentation off the
 * skill-load sub-check yields 'unknown' (proxy mode) and routing still
 * decides.
 */
export function contactPageExpectationsScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  calibrate: boolean = false,
): Scenario {
  return createPromptVsSkillScenario(
    {
      name: 'pvs-contact-page-expectations',
      goals: [
        {
          description:
            'Build a landing page for a small business with a hero '
            + 'section and a way for visitors to get in contact',
          assertion: 'positive',
        },
      ],
      staticFirstMessage:
        'Build a landing page for my small business. It needs a hero '
        + 'section with a headline, and a way for visitors to contact me.',
      extraEvaluators: [
        new ExpectedArtifactMatchEvaluator(),
        new DirectionalSignalEvaluator(),
        new SkillSelectionEvaluator(),
      ],
      calibrationEvaluators: [createNarrowArtifactJudge(gocode)],
      calibrate,
      expectedArtifact: contactPageExpectation,
      expectedAgent: DEVELOP_AGENT_DISPLAY_NAME,
      expectedSkills: ['inbox'],
    },
    gocode,
    ctrlPlane,
  );
}
