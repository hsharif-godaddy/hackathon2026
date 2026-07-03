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
 * Reproduces **skill non-selection on Online Appointments** — the most
 * directly-documented failure on the refactor list. The OA skill was measured
 * loading its instructions only ~30% of the time (and that accidentally rather
 * than intentionally), a reliability gap that also bleeds into
 * online-conferencing, marketing-campaigns and commerce. Its `whenToUse` says
 * to load IMMEDIATELY for ANY booking/appointment/scheduling intent, so a
 * non-load is unambiguously the failure: the agent hand-builds a booking form +
 * availability logic from pretrained knowledge instead of using the skill's
 * full system (date/time selection, intake, confirmations, admin dashboard).
 *
 * The user intent uses a listed keyword ("take bookings"/"appointments") with
 * no mention of "skill", so a model that doesn't route will scaffold its own.
 *
 * Detection: `expectedSkills: ['online-appointments']` drives
 * `SkillSelectionEvaluator` — with `SKILL_DIAGNOSTICS=true` a run where the
 * skill never loads scores `fail`, directly measuring the ~30%-load gap; the
 * required `skillInstructions` give the narrow LLM judge a second,
 * instrumentation-independent signal.
 *
 * NOTE: this scenario runs through `createSkillEval` with
 * `requireSkillDiagnostics: true`, so `SKILL_DIAGNOSTICS=true` is required on
 * the agent. Without it the skill-load check hard-fails (a broken gate),
 * rather than degrading to `unknown`; the required `skillInstructions` still
 * give the narrow LLM judge an instrumentation-independent signal.
 */
export function onlineAppointmentsNonSelectionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario {
  const base = getSkillEvalBaseInjection(config);
  return createSkillEval(
    {
      name: 'skill-non-selection-online-appointments',
      skill: 'online-appointments',
      userIntent:
        'I run a consultancy and want clients to be able to book a 60-minute '
        + 'session with me on my site, picking an open time slot.',
      goals: [
        {
          description:
            'Agent loads the online-appointments skill rather than '
            + 'hand-building booking + availability logic from scratch',
          assertion: 'positive',
        },
        {
          description:
            'Clients can pick an open time slot and book a session that is '
            + 'durably recorded',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'uses-online-appointments-skill',
          instruction:
            'The agent must load the online-appointments skill to handle the '
            + 'booking request (its templated date/time selection, intake '
            + 'form, and appointment persistence). It must NOT hand-build a '
            + 'custom booking form, availability calculator, or appointment '
            + 'table from pretrained knowledge.',
          priority: 'required',
        },
        {
          id: 'no-adhoc-booking-scaffold',
          instruction:
            'The agent must not scaffold its own slot/availability logic '
            + '(a hand-written calendar grid, an ad-hoc /api/book handler, a '
            + 'custom availability algorithm) in place of the '
            + 'online-appointments skill.',
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
