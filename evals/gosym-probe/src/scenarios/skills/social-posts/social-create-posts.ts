import { createSkillEval } from '../../skill-eval/create-skill-eval.js';
import {
  DEVELOP_AGENT_DISPLAY_NAME,
  NO_MARKETING_HANDOFF,
} from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * Develop-owned behavior (post-deprecation): an explicit "create Instagram
 * posts" request is handled directly on develop — NO handoff to a standalone
 * marketing agent — which loads the social-posts skill and creates the post(s)
 * via the socialPostCreate tool (not prose) — and does not over-claim the posts
 * are live. Develop-world counterpart of the RUBICON-543 baseline.
 *
 * Not subsumed by: social-infer-not-interrogate (inference vs interrogation on
 * an under-specified prompt); this tests the explicit create-via-tool path.
 *
 * Construct validity:
 * - False positive: guarded by NO marketing handoff + the real socialPostCreate
 *   tool (social-posts registers no tools of its own; socialPostCreate is the
 *   actual creation tool).
 * - False negative: the registry only includes this scenario when
 *   ENABLE_SOCIAL=true (the AAB agent gates the social tools on that flag).
 * - Missing coverage: platform publish is out of scope (and must not be claimed).
 */
export function socialCreatePostsScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'social-create-posts',
      skill: 'social-posts',
      suite: 'social-posts',
      userIntent: 'Create Instagram posts about our weekend brunch special',
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
            'The social-posts skill is loaded and the post(s) are created via the socialPostCreate tool',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'loads-social-posts',
          instruction:
            'The social-posts skill must be loaded to handle the request.',
          priority: 'required',
        },
        {
          id: 'creates-via-tool',
          instruction:
            'The agent must create the post(s) by calling the socialPostCreate '
            + 'tool, not by only describing the post in prose.',
          priority: 'required',
        },
        {
          id: 'no-premature-publish',
          instruction:
            'The agent must NOT claim the posts are published, live, '
            + 'scheduled, or sent. socialPostCreate produces drafts the user '
            + 'reviews and publishes.',
          priority: 'required',
        },
      ],
      expectedTools: [
        NO_MARKETING_HANDOFF,
        { tool: 'skill', called: true },
        { tool: 'socialPostCreate', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
