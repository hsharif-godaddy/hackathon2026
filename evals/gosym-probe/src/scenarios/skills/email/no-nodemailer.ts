import { createEmailScenario } from './create-email-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noNodemailerScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createEmailScenario(
    {
      name: 'email-no-nodemailer',
      staticFirstMessage:
        'I need to send emails from my app using nodemailer',
      goals: [
        {
          description: 'Agent installs the email skill instead of nodemailer',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT install nodemailer as a dependency',
          assertion: 'positive',
        },
        {
          description: 'Agent uses sendEmail from @/server/email (not nodemailer createTransport)',
          assertion: 'positive',
        },
        {
          description: 'Agent explains that the platform email gateway handles SMTP',
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
