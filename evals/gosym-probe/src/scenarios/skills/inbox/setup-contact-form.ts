import { createInboxScenario } from './create-inbox-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function setupContactFormScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createInboxScenario(
    {
      name: 'inbox-setup-contact-form',
      staticFirstMessage:
        'I need a contact page where visitors can send me a message',
      goals: [
        {
          description:
            'Agent loads the inbox skill via'
            + ' skill({ action: "load", skill: "inbox" })',
          assertion: 'positive',
        },
        {
          description:
            'Agent calls inbox__setup_contact_form to handle'
            + ' the full account provisioning + form setup flow'
            + ' in a single call',
          assertion: 'positive',
        },
        {
          description:
            'Agent generates a form component that POSTs to the'
            + ' returned postUrl',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'inbox__setup_contact_form', called: true },
      ],
      skillInstructions: [
        {
          id: 'uses-workflow-tool',
          instruction:
            'The agent must call inbox__setup_contact_form (the single-call'
            + ' workflow tool) rather than the multi-step sequence of'
            + ' inbox__discover_account followed by inbox__setup_form.',
          priority: 'required',
        },
        {
          id: 'no-email-skill',
          instruction:
            'The agent must never load, invoke, or mention the email skill.'
            + ' The inbox backend handles all email sending automatically.',
          priority: 'required',
        },
        {
          id: 'correct-notification-framing',
          instruction:
            'When explaining how notifications work, the agent should say'
            + ' the owner will receive an email notification and can view'
            + ' messages from the Inbox tab in the builder.',
          priority: 'advisory',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
