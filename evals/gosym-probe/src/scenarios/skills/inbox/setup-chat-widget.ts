import { createInboxScenario } from './create-inbox-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function setupChatWidgetScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createInboxScenario(
    {
      name: 'inbox-setup-chat-widget',
      staticFirstMessage:
        'Add a chat widget to my site so visitors can message me',
      goals: [
        {
          description:
            'Agent loads the inbox skill via'
            + ' skill({ action: "load", skill: "inbox" })',
          assertion: 'positive',
        },
        {
          description:
            'Agent calls inbox__setup_chat_widget to handle'
            + ' the full account provisioning + widget setup flow'
            + ' in a single call',
          assertion: 'positive',
        },
        {
          description:
            'Agent mounts <InboxChatWidget /> in App.tsx after'
            + ' the workflow tool returns phase "complete"',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'inbox__setup_chat_widget', called: true },
      ],
      skillInstructions: [
        {
          id: 'uses-workflow-tool',
          instruction:
            'The agent must call inbox__setup_chat_widget (the single-call'
            + ' workflow tool) rather than the multi-step sequence of'
            + ' inbox__discover_account followed by inbox__setup_widget.',
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
          id: 'mounts-widget-component',
          instruction:
            'After setup_chat_widget returns phase "complete", the agent'
            + ' must mount <InboxChatWidget /> in src/App.tsx outside any'
            + ' route switch.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
