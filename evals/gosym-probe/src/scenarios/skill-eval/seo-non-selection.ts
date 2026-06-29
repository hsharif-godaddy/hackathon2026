import { createSkillEval } from './create-skill-eval.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

/**
 * Reproduces **skill non-selection on SEO**. The seo skill was one of the
 * refactor targets flagged for being over the 500-line ceiling (645 lines —
 * `/skill-review` catalog scan, #5174 SEO refactor): an oversized skill.md
 * loses the model's attention mid-document, so the agent never routes to the
 * skill and instead hand-writes meta tags / JSON-LD from pretrained knowledge
 * rather than using the skill's v8 patterns (react-helmet head tags +
 * `seo-routes.ts` registration).
 *
 * The user intent is phrased as a plain "get found on Google" ask — a trigger
 * phrase the skill's `whenToUse` explicitly lists — with no mention of "skill"
 * so a model leaning on pretrained patterns will scaffold raw `<meta>`/Helmet
 * itself instead of loading the skill.
 *
 * Detection: `expectedSkills: ['seo']` drives `SkillSelectionEvaluator` — with
 * `SKILL_DIAGNOSTICS=true`, a run where the skill never loads scores `fail`
 * (non-selection caught); the required `skillInstructions` give the narrow LLM
 * judge a second, instrumentation-independent signal.
 *
 * NOTE: skill-load detection needs `SKILL_DIAGNOSTICS=true` on the agent, or
 * the skill-load check degrades to an `unknown` verdict (dropped from the pass
 * rate) and only the instruction signals remain.
 */
export function seoNonSelectionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'skill-non-selection-seo',
      skill: 'seo',
      userIntent:
        'My site isn\'t showing up when people search for it on Google. '
        + 'Can you help it get found?',
      goals: [
        {
          description:
            'Agent loads the seo skill and applies its v8 patterns rather '
            + 'than hand-writing meta tags from pretrained knowledge',
          assertion: 'positive',
        },
        {
          description:
            'The site gains the head tags / structured data needed to be '
            + 'discoverable in search',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'uses-seo-skill',
          instruction:
            'The agent must use the seo skill (its v8 react-helmet head-tag '
            + 'patterns and seo-routes.ts registration) to add SEO metadata. '
            + 'It must NOT hand-author raw <meta>/JSON-LD scaffolding from '
            + 'pretrained boilerplate in place of the skill.',
          priority: 'required',
        },
        {
          id: 'no-pretrained-meta-scaffold',
          instruction:
            'The agent must not fall back on generic pretrained SEO snippets '
            + '(a bare list of <meta name="description"> tags or an inline '
            + 'react-helmet block) instead of routing the request to the '
            + 'project\'s seo skill.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
