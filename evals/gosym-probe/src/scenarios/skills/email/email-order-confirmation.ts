import { createEmailScenario } from './create-email-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function emailOrderConfirmationScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createEmailScenario(
    {
      name: 'email-order-confirmation',
      staticFirstMessage:
        'Add an order confirmation email that gets sent to the customer after they complete a purchase',
      goals: [
        {
          description: 'Agent installs the email skill via skill({ action: "install", skill: "email" })',
          assertion: 'positive',
        },
        {
          description: 'Agent uses sendEmail from @/server/email (not nodemailer or direct gateway POST)',
          assertion: 'positive',
        },
        {
          description: 'Agent passes the customer email dynamically from application data (not hardcoded, not from requestSecrets)',
          assertion: 'positive',
        },
        {
          description: 'Agent omits the from field or uses only a hardcoded verified-domain sender',
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
