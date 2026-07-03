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
 * Reproduces the **wrong skill routing** failure mode for the
 * online-appointments ↔ online-conferencing confusable pair (squad task 2a.ii,
 * Brandon's #5550 gap review — the one missing grounded confusable pair). It
 * also strengthens online-appointments, the worst-performing skill (~30% load
 * rate), by giving it a second detection angle beyond plain non-selection.
 *
 * The pair is genuinely confusable, and the two skills' own `whenToUse` blocks
 * draw the line: a "video consultations" ask hits online-conferencing's keyword
 * list ("video consultations", "video calls", "telehealth"), but the *job* —
 * end users picking an open time slot to book a session — is online-appointments'.
 * online-conferencing only ADDS a meeting link to an already-scheduled feature
 * ("Use online-appointments for booking/scheduling. DO NOT load for: scheduling
 * without video, booking calendars, time slots, date pickers"); it owns no
 * availability, slots, or booking persistence. So the entry point must be
 * online-appointments, which later composes with conferencing for the link.
 *
 * The plausible misroute is the agent reaching for online-conferencing first
 * (matching on "video") and hand-building, or skipping, the actual booking
 * system — leaving the user with link generation but no calendar, slots, or
 * appointment records.
 *
 * Detection (two independent signals):
 *  - `expectedSkills: ['online-appointments']` → `SkillSelectionEvaluator`
 *    skill-load check: fails if online-appointments never loads (e.g.
 *    conferencing loaded as the entry point instead). Needs
 *    `SKILL_DIAGNOSTICS=true`; without it the check degrades to `unknown`.
 *  - the required `no-conferencing-entry-point` instruction → narrow LLM judge
 *    fails the trial if the agent treats online-conferencing as the primary
 *    solution, an instrumentation-independent catch for the misroute.
 *
 * `expectedAgent` is intentionally omitted: both correct and misrouted paths
 * run under the same develop agent, so the discriminating signal is *which
 * skill* loaded, not which agent.
 *
 * Not subsumed by `skill-non-selection-online-appointments`: that scenario
 * tests OA *non-load* on a video-free booking ask (the agent hand-builds slot
 * logic). This one isolates the *misroute hypothesis* — a video-flavored
 * booking ask pulling the agent to online-conferencing instead of OA — via a
 * `required` no-conferencing-entry-point instruction. Different failure modes,
 * so both earn their place.
 */
export function appointmentsVsConferencingRoutingScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario {
  const base = getSkillEvalBaseInjection(config);
  return createSkillEval(
    {
      name: 'wrong-skill-routing-appointments-vs-conferencing',
      skill: 'online-appointments',
      userIntent:
        'I coach clients over video. I want people to book a 1-hour session '
        + 'with me by picking an open time slot, and each booking should be a '
        + 'video call.',
      goals: [
        {
          description:
            'Agent routes the booking request to the online-appointments '
            + 'skill (the booking system owner), not online-conferencing',
          assertion: 'positive',
        },
        {
          description:
            'Clients can pick an open time slot and book a session that is '
            + 'durably recorded, with a video link attached to the booking',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'routes-to-online-appointments',
          instruction:
            'The agent must handle this with the online-appointments skill as '
            + 'the entry point (its date/time selection, availability, intake, '
            + 'and appointment persistence). The ask is a booking system with '
            + 'time slots, which is online-appointments\' job.',
          priority: 'required',
        },
        {
          id: 'no-conferencing-entry-point',
          instruction:
            'The agent must NOT treat online-conferencing as the primary '
            + 'solution or load it instead of online-appointments. '
            + 'online-conferencing only ADDS a meeting link to an already-built '
            + 'scheduled feature; it owns no booking calendar, time slots, or '
            + 'availability. Reaching for it as the entry point — leaving the '
            + 'user with link generation but no booking system — is the '
            + 'wrong-skill misroute this scenario detects. (Adding the video '
            + 'link via conferencing is a valid later step once the appointment '
            + 'system exists, not the starting point.)',
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
