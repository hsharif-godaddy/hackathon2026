import { createSkillEval } from './create-skill-eval.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

/**
 * Reproduces **skill non-selection on Google Analytics**. The GA refactor
 * replaced LLM-driven file edits with a deterministic install tool (skill
 * refactoring announcement, #4780): the failure it fixed is the agent
 * hand-pasting a raw `gtag.js` / `G-XXXX` snippet into the page from pretrained
 * knowledge instead of routing through the skill's install flow (which also
 * gates tracking behind the GDPR cookie-consent banner). A hand-rolled snippet
 * skips consent and is exactly the non-deterministic file-edit path the
 * refactor removed.
 *
 * The user intent uses a listed trigger phrase ("track visitors") with no
 * mention of "skill", so a model leaning on pretrained patterns will inline a
 * gtag snippet itself.
 *
 * Detection: `expectedSkills: ['google-analytics']` drives
 * `SkillSelectionEvaluator` — with `SKILL_DIAGNOSTICS=true` a run where the
 * skill never loads scores `fail`; the required `skillInstructions` give the
 * narrow LLM judge an instrumentation-independent second signal.
 *
 * NOTE: needs `SKILL_DIAGNOSTICS=true`, else the skill-load check degrades to
 * `unknown` (dropped from the pass rate).
 */
export function googleAnalyticsNonSelectionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'skill-non-selection-google-analytics',
      skill: 'google-analytics',
      userIntent:
        'I want to track how many visitors my site gets and which pages '
        + 'they look at.',
      goals: [
        {
          description:
            'Agent loads the google-analytics skill and uses its install '
            + 'flow rather than hand-pasting a gtag snippet',
          assertion: 'positive',
        },
        {
          description:
            'Visitor tracking is wired up behind the cookie-consent banner',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'uses-ga-skill',
          instruction:
            'The agent must use the google-analytics skill (request the GA4 '
            + 'Measurement ID via requestSecrets and run the skill\'s install '
            + 'flow). It must NOT hand-paste a raw gtag.js / G-XXXXXXXXXX '
            + 'snippet into the page from pretrained knowledge.',
          priority: 'required',
        },
        {
          id: 'no-inline-gtag',
          instruction:
            'The agent must not inject an inline <script> gtag tracking '
            + 'snippet or hardcode a Measurement ID outside the skill\'s '
            + 'install flow, which is the non-deterministic hand-edit path the '
            + 'GA refactor replaced with a deterministic install tool.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
