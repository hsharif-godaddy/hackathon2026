import { createInboxScenario } from './create-inbox-scenario.js';
import { standardPersona } from '../../../personas/standard.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function whereAreMessagesScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createInboxScenario(
    {
      name: 'inbox-where-are-messages',
      persona: standardPersona,
      staticFirstMessage:
        'Where can I see messages from my visitors?',
      goals: [
        {
          description:
            'Agent loads the inbox skill to handle the'
            + ' navigational query about message location',
          assertion: 'positive',
        },
        {
          description:
            'Agent tells the user messages are in the Inbox tab'
            + ' within this builder (not an external site)',
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
            'The agent must tell the user that messages are available'
            + ' in the Inbox tab within this builder (the same interface'
            + ' they are chatting in). It must NOT direct them to'
            + ' godaddy.com, any external URL, or any site outside'
            + ' this builder.',
          priority: 'required',
        },
        {
          id: 'no-invented-urls',
          instruction:
            'The agent must not invent or fabricate any URL for viewing'
            + ' messages. The Inbox is accessed via the sidebar tab,'
            + ' not a URL.',
          priority: 'required',
        },
        {
          id: 'no-email-skill',
          instruction:
            'The agent must never load or invoke the email skill'
            + ' when answering questions about where messages go.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
