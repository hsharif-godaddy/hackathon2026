import { createSkillEval } from './create-skill-eval.js';
import { getSkillEvalBaseInjection }
  from './skill-eval-base.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import type { Config }
  from '../../../config/environments/types.js';

/**
 * Reproduces **skill non-selection on email** — the last tracker skill with
 * zero positive coverage and the only gap on the non-selection axis (Brandon's
 * #5550 gap review). email is otherwise present in the suite only as the
 * *forbidden* skill in `wrong-skill-routing-inbox-vs-email`; nothing tests that
 * the agent actually *loads* it when transactional email is the genuine job.
 *
 * The email skill's whole point is the managed Airo email gateway: it installs
 * a `sendEmail()` helper (`src/server/email.ts`) that POSTs to the gateway,
 * which applies the platform's sender-identity policy and forwards to the
 * hosting relay. The failure mode is the agent hand-wiring `nodemailer`/SMTP
 * from pretrained knowledge instead — exactly the path the skill exists to
 * replace (and which its `whenToUse` calls out by listing "nodemailer"/"smtp"
 * as trigger phrases).
 *
 * The user intent is a plain transactional-email ask ("email the customer a
 * receipt") — a listed trigger phrase — with no mention of "skill", "gateway",
 * or "sendEmail", so a model leaning on pretrained patterns will reach for
 * nodemailer itself rather than loading the skill.
 *
 * Detection: `expectedSkills: ['email']` drives `SkillSelectionEvaluator` —
 * with `SKILL_DIAGNOSTICS=true`, a run where the skill never loads scores
 * `fail` (non-selection caught); the required `skillInstructions` give the
 * narrow LLM judge a second, instrumentation-independent signal.
 *
 * NOTE: this scenario runs through `createSkillEval` with
 * `requireSkillDiagnostics: true`, so `SKILL_DIAGNOSTICS=true` is required on
 * the agent. Without it the skill-load check hard-fails (a broken gate)
 * rather than degrading to `unknown`; the required `skillInstructions` still
 * give the narrow LLM judge an instrumentation-independent signal.
 *
 * Not a contact-form ask: a contact form routes to inbox (which sends owner
 * notifications automatically), so the intent is deliberately a *transactional*
 * email triggered by an app event (order placed → receipt to the buyer), which
 * is email's job, not inbox's.
 */
export function emailNonSelectionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario {
  const base = getSkillEvalBaseInjection(config);
  return createSkillEval(
    {
      name: 'skill-non-selection-email',
      skill: 'email',
      userIntent:
        'When a customer places an order on my site, automatically send '
        + 'them a receipt with their order details.',
      goals: [
        {
          description:
            'Agent loads the email skill and sends via its managed gateway '
            + 'helper rather than hand-wiring SMTP from pretrained knowledge',
          assertion: 'positive',
        },
        {
          description:
            'A customer who places an order receives a receipt email with '
            + 'their order details',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'uses-email-skill',
          instruction:
            'The agent must use the email skill to send the receipt — install '
            + 'it and call the `sendEmail()` helper (src/server/email.ts) that '
            + 'POSTs to the Airo email gateway. It must NOT hand-author its own '
            + 'mail-sending code in place of the skill.',
          priority: 'required',
        },
        {
          id: 'no-nodemailer-smtp',
          instruction:
            'The agent must NOT reach for nodemailer, a raw SMTP transport, or '
            + 'a direct third-party email API (SendGrid/SES/etc.) instead of '
            + 'the email skill. Hand-wiring SMTP/nodemailer from pretrained '
            + 'boilerplate is the non-selection failure this scenario detects; '
            + 'the gateway helper is the only sanctioned send path.',
          priority: 'required',
        },
      ],
      statefulInjection: base?.injection,
    },
    gocode,
    ctrlPlane,
    base?.seedSummary,
  );
}
