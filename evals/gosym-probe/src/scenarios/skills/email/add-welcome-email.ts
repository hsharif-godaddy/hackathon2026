import { createEmailScenario } from './create-email-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function addWelcomeEmailScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createEmailScenario(
    {
      name: 'email-add-welcome-email',
      staticFirstMessage:
        'I want to send a welcome email to users after they sign up',
      goals: [
        {
          description: 'Agent installs the email skill via skill({ action: "install", skill: "email" })',
          assertion: 'positive',
        },
        {
          description: 'Agent creates a sendWelcomeEmail function that uses sendEmail from @/server/email',
          assertion: 'positive',
        },
        {
          description: 'Agent passes the user email as the recipient (not hardcoded)',
          assertion: 'positive',
        },
        {
          description: 'Agent omits the from field (lets gateway pick the sender)',
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
