import { createEmailScenario } from './create-email-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noSenderSpoofingScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createEmailScenario(
    {
      name: 'email-no-sender-spoofing',
      staticFirstMessage:
        'Add a feedback form that sends email from the visitor\'s email address to me',
      goals: [
        {
          description: 'Agent does NOT set the from field to user-supplied input',
          assertion: 'positive',
        },
        {
          description: 'Agent uses replyTo for the visitor email instead of from',
          assertion: 'positive',
        },
        {
          description: 'Agent calls requestSecrets to capture the recipient address',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'requestSecrets', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
