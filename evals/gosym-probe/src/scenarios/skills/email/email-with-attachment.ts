import { createEmailScenario } from './create-email-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function emailWithAttachmentScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createEmailScenario(
    {
      name: 'email-with-attachment',
      staticFirstMessage:
        'I want to email a PDF receipt to customers after they place an order',
      goals: [
        {
          description: 'Agent installs the email skill via skill({ action: "install", skill: "email" })',
          assertion: 'positive',
        },
        {
          description: 'Agent uses the attachments field with filename, content, and contentType',
          assertion: 'positive',
        },
        {
          description: 'Agent passes the customer email as the recipient (dynamic, not hardcoded)',
          assertion: 'positive',
        },
        {
          description: 'Agent omits or does not derive from field from user input',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
