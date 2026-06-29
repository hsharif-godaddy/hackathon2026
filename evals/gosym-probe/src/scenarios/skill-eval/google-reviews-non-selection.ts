import { createSkillEval } from './create-skill-eval.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

/**
 * Reproduces **skill non-selection on Google Reviews**. The google-reviews
 * refactor consolidated a 3–5 tool-call flow into a single stateful workflow
 * (skill refactoring announcement): the failure it fixed is the agent either
 * not routing to the skill at all and hand-embedding a Google reviews widget /
 * Places API call from pretrained knowledge, or orchestrating the old loose
 * micro-tool sequence inconsistently. Both lose the skill's OAuth/connection
 * state that survives summarization.
 *
 * The user intent uses a listed trigger phrase ("show my Google reviews") with
 * no mention of "skill", so a model leaning on pretrained patterns will embed
 * its own widget instead of calling `google-reviews__checkConnection`.
 *
 * Detection: `expectedSkills: ['google-reviews']` drives
 * `SkillSelectionEvaluator` — with `SKILL_DIAGNOSTICS=true` a run where the
 * skill never loads scores `fail`; the required `skillInstructions` give the
 * narrow LLM judge an instrumentation-independent second signal.
 *
 * NOTE: needs `SKILL_DIAGNOSTICS=true`, else the skill-load check degrades to
 * `unknown` (dropped from the pass rate).
 */
export function googleReviewsNonSelectionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'skill-non-selection-google-reviews',
      skill: 'google-reviews',
      userIntent:
        'Show the customer reviews from my Google Business Profile on my '
        + 'site, with the star ratings.',
      goals: [
        {
          description:
            'Agent loads the google-reviews skill and uses its consolidated '
            + 'workflow tools rather than hand-embedding a reviews widget',
          assertion: 'positive',
        },
        {
          description:
            'The site displays the owner\'s Google reviews and star ratings',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'uses-google-reviews-skill',
          instruction:
            'The agent must use the google-reviews skill workflow '
            + '(google-reviews__checkConnection then '
            + 'google-reviews__fetchReviews) to fetch and embed reviews. It '
            + 'must NOT hand-embed a third-party reviews widget or call the '
            + 'Google Places API directly from pretrained knowledge.',
          priority: 'required',
        },
        {
          id: 'no-adhoc-reviews-embed',
          instruction:
            'The agent must not scaffold its own reviews fetch/render (an '
            + 'iframe widget, a hardcoded Place ID + API key, or a manual '
            + 'fetch loop) in place of the skill\'s consolidated workflow '
            + 'tool, which is the loose micro-tool path the refactor replaced.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
