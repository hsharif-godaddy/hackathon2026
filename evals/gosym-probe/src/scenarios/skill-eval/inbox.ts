import { createSkillEval } from './create-skill-eval.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

export function inboxSkillEvalScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'skill-eval-inbox',
      skill: 'inbox',
      userIntent:
        'I need a contact page where visitors can send me a message.',
      goals: [
        {
          description:
            'Agent loads the inbox skill to handle the contact form request',
          assertion: 'positive',
        },
        {
          description:
            'Agent sets up a working contact form that visitors can submit',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'calls-discover-account',
          instruction:
            'The agent must call inbox__discover_account before calling '
            + 'inbox__setup_form or inbox__setup_widget.',
          priority: 'required',
        },
        {
          id: 'no-email-skill',
          instruction:
            'The agent must never load, invoke, or mention the email skill. '
            + 'The inbox backend handles all email sending automatically.',
          priority: 'required',
        },
        {
          id: 'correct-notification-framing',
          instruction:
            'When explaining how notifications work, the agent should say '
            + 'the owner will receive an email notification, not that '
            + 'submissions "land in your Inbox" or reference any inbox '
            + 'dashboard/view/interface.',
          priority: 'advisory',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
