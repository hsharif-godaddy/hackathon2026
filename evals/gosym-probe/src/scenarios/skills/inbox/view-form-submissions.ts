import { createInboxScenario } from './create-inbox-scenario.js';
import { standardPersona } from '../../../personas/standard.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function viewFormSubmissionsScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createInboxScenario(
    {
      name: 'inbox-view-form-submissions',
      persona: standardPersona,
      staticFirstMessage:
        'How do I see the contact form submissions from my website?',
      goals: [
        {
          description:
            'Agent loads the inbox skill to handle the'
            + ' navigational query about form submissions',
          assertion: 'positive',
        },
        {
          description:
            'Agent explains that form submissions appear in the'
            + ' Inbox tab within this builder',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
      ],
      skillInstructions: [
        {
          id: 'inbox-is-in-builder',
          instruction:
            'The agent must tell the user that contact form submissions'
            + ' appear in the Inbox tab within this builder. It must NOT'
            + ' direct them to an external URL or dashboard.',
          priority: 'required',
        },
        {
          id: 'mentions-email-notification',
          instruction:
            'The agent should mention that the user also receives an'
            + ' email notification when a submission arrives.',
          priority: 'advisory',
        },
        {
          id: 'no-email-skill',
          instruction:
            'The agent must never load or invoke the email skill.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
