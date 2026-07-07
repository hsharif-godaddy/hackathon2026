import { createInboxScenario } from './create-inbox-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noMultiStepSetupScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createInboxScenario(
    {
      name: 'inbox-no-multi-step-setup',
      staticFirstMessage:
        'Can you set up live chat on my website so customers'
        + ' can reach me directly?',
      goals: [
        {
          description:
            'Agent loads the inbox skill',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT call discover_account separately'
            + ' — the workflow tool handles provisioning internally',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'inbox__setup_chat_widget', called: true },
        { tool: 'inbox__discover_account', called: false },
      ],
      skillInstructions: [
        {
          id: 'no-discover-account-call',
          instruction:
            'The agent must NOT call inbox__discover_account as a'
            + ' separate step. The workflow tool (setup_chat_widget or'
            + ' setup_contact_form) handles account provisioning'
            + ' internally.',
          priority: 'required',
        },
        {
          id: 'no-email-skill',
          instruction:
            'The agent must never load, invoke, or mention the email'
            + ' skill.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
