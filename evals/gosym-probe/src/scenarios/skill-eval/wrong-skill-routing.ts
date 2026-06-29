import { createSkillEval } from './create-skill-eval.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

/**
 * Reproduces the **wrong skill routing** failure mode (squad task 2a.ii): the
 * agent DOES reach for a skill, but the wrong one. A contact form is the inbox
 * skill's job (it handles submission storage + owner notification), yet a
 * plausible misroute is to load the email skill and hand-wire SMTP sending.
 *
 * Detection (two independent signals):
 *  - `expectedSkills: ['inbox']` → `SkillSelectionEvaluator` skill-load check:
 *    fails if inbox never loads (e.g. email loaded instead). Needs
 *    `SKILL_DIAGNOSTICS=true`; without it the skill-load check degrades to
 *    `unknown`.
 *  - the required `no-email-skill` instruction → narrow LLM judge fails the
 *    trial if the email skill is loaded/invoked, an instrumentation-independent
 *    catch for the misroute.
 *
 * `expectedAgent` is intentionally omitted: both correct and misrouted paths
 * run under the same develop agent, so the discriminating signal here is
 * *which skill* was loaded, not which agent — overspecifying the agent would
 * add a check that can't distinguish the two paths.
 *
 * Not subsumed by `skill-eval-inbox`: that scenario tests the inbox *happy
 * path* (does inbox load and produce a working contact form, with an advisory
 * notification-framing check). This one isolates the *misroute hypothesis* —
 * the agent reaching for the email skill instead — as the thing under test, via
 * a `required` no-email-skill instruction. They measure different things (happy
 * path vs failure mode), so both earn their place despite the shared surface.
 */
export function wrongSkillRoutingScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'wrong-skill-routing-inbox-vs-email',
      skill: 'inbox',
      userIntent:
        'Add a contact form to my site so people can send me a message.',
      goals: [
        {
          description:
            'Agent routes the contact-form request to the inbox skill, not '
            + 'the email skill',
          assertion: 'positive',
        },
        {
          description:
            'Visitors can submit the contact form and the owner is notified',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'routes-to-inbox',
          instruction:
            'The agent must handle the contact form with the inbox skill '
            + '(inbox__discover_account then inbox__setup_form/inbox__setup_widget).',
          priority: 'required',
        },
        {
          id: 'no-email-skill',
          instruction:
            'The agent must NOT load, invoke, or hand-wire the email skill '
            + '(no SMTP/nodemailer/sendEmail scaffolding). The inbox backend '
            + 'sends owner notifications automatically; reaching for email is '
            + 'the wrong-skill misroute this scenario detects.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
