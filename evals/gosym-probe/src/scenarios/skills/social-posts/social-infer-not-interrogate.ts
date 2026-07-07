import { createSkillEval } from '../../skill-eval/create-skill-eval.js';
import {
  DEVELOP_AGENT_DISPLAY_NAME,
  NO_MARKETING_HANDOFF,
} from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * Develop-owned behavior (post-deprecation): a terse "create Facebook posts for
 * my coffee shop" request is handled directly on develop — NO handoff to a
 * standalone marketing agent — which infers sensible post details rather than
 * over-interrogating, creates via socialPostCreate, and does not over-claim the
 * posts are live. Develop-world counterpart of the RUBICON-543 baseline.
 *
 * Not subsumed by: social-create-posts (explicit create-via-tool path); this
 * isolates infer-vs-interrogate on an under-specified prompt.
 *
 * Construct validity:
 * - False positive: guarded by NO marketing handoff + socialPostCreate; the
 *   infer-not-interrogate intent is an advisory skill-outcome instruction.
 * - False negative: the registry only includes this scenario when
 *   ENABLE_SOCIAL=true (the AAB agent gates the social tools on that flag).
 * - Missing coverage: platform publish out of scope (must not be claimed).
 */
export function socialInferNotInterrogateScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'social-infer-not-interrogate',
      skill: 'social-posts',
      suite: 'social-posts',
      userIntent: 'Create some Facebook posts for my coffee shop',
      expectedAgent: DEVELOP_AGENT_DISPLAY_NAME,
      trials: 5,
      goals: [
        {
          description:
            'The develop agent creates the posts directly, without handing off to a standalone marketing agent',
          assertion: 'negative',
        },
        {
          description:
            'The agent infers post details from the business context rather than over-interrogating, and creates via socialPostCreate',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'infers-from-context',
          instruction:
            'The agent should infer sensible defaults (tone, topic, hashtags) '
            + 'from the stated business rather than asking many clarifying '
            + 'questions before creating a first draft.',
          priority: 'advisory',
        },
        {
          id: 'creates-via-tool',
          instruction:
            'The agent must create the post(s) by calling the socialPostCreate '
            + 'tool, not by only describing the post in prose.',
          priority: 'required',
        },
        {
          id: 'minimal-questions',
          instruction:
            'The agent should ask at most one clarifying question before '
            + 'producing a first draft, inferring the rest from the business.',
          priority: 'advisory',
        },
        {
          id: 'no-premature-publish',
          instruction:
            'The agent must NOT claim the posts are published, live, '
            + 'scheduled, or sent — socialPostCreate produces drafts the user '
            + 'publishes.',
          priority: 'required',
        },
      ],
      expectedTools: [
        NO_MARKETING_HANDOFF,
        { tool: 'socialPostCreate', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
