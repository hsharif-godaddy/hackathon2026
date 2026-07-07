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

export function inboxSkillEvalScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
  config?: Config,
): Scenario {
  const base = getSkillEvalBaseInjection(config);
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
          id: 'uses-workflow-tool',
          instruction:
            'The agent must call inbox__setup_contact_form (the single-call '
            + 'workflow tool) rather than the multi-step sequence of '
            + 'inbox__discover_account followed by inbox__setup_form.',
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
            + 'the owner will receive an email notification and can view '
            + 'messages from the Inbox tab in the builder.',
          priority: 'advisory',
        },
      ],
      statefulInjection: base?.injection,
    },
    gocode,
    ctrlPlane,
    base?.seedSummary,
  );
}
