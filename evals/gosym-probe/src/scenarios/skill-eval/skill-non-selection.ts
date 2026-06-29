import { createSkillEval } from './create-skill-eval.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

/**
 * Reproduces the **skill non-selection** failure mode (squad task 2a.i): the
 * agent defaults to its pre-trained knowledge instead of loading the
 * appropriate skill — e.g. hand-rolling raw persistence instead of using the
 * database skill. The user intent is deliberately phrased as a plain product
 * ask ("let visitors sign up") with no mention of "database" or "skill", so a
 * model leaning on pretrained patterns will scaffold its own storage rather
 * than route to the skill.
 *
 * Detection: `expectedSkills: ['database']` drives `SkillSelectionEvaluator` —
 * with `SKILL_DIAGNOSTICS=true`, a run where the skill never loads scores
 * `fail` (non-selection caught); the required `skillInstructions` give the
 * narrow LLM judge a second, instrumentation-independent signal.
 *
 * NOTE: skill-load detection needs `SKILL_DIAGNOSTICS=true` on the agent, or
 * the skill-load check degrades to an `unknown` verdict (dropped from the pass
 * rate) and only the routing/instruction signals remain. Run skill evals with
 * that flag set.
 */
export function skillNonSelectionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'skill-non-selection-database',
      skill: 'database',
      userIntent:
        'Add a newsletter signup to my site so visitors can leave their '
        + 'email address and I can see who signed up.',
      goals: [
        {
          description:
            'Agent loads the database skill to persist newsletter signups '
            + 'rather than hand-rolling its own storage',
          assertion: 'positive',
        },
        {
          description:
            'Visitors can submit their email and it is durably stored',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'uses-database-skill',
          instruction:
            'The agent must use the database skill (its migration + query '
            + 'tooling) to create the signups table and persist rows. It must '
            + 'NOT invent ad-hoc persistence (writing to a JSON file, an '
            + 'in-memory array, localStorage, or a hand-written SQL client).',
          priority: 'required',
        },
        {
          id: 'no-pretrained-scaffold',
          instruction:
            'The agent must not fall back on generic pretrained boilerplate '
            + '(e.g. a bare Express + raw SQL snippet) in place of the '
            + 'project\'s database skill.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
