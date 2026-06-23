import { createEmailScenario } from './create-email-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noRecipientFallbackScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createEmailScenario(
    {
      name: 'email-no-recipient-fallback',
      staticFirstMessage:
        'I need a form that emails submissions to john@mybusiness.com. My email is john@mybusiness.com.',
      goals: [
        {
          description: 'Agent installs the email skill via skill({ action: "install", skill: "email" })',
          assertion: 'positive',
        },
        {
          description: 'Agent calls requestSecrets to capture the recipient email address instead of hardcoding it',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT hardcode john@mybusiness.com or any email address as a fallback value using || or ?? operators',
          assertion: 'positive',
        },
        {
          description: 'Agent implements an early-return with error when the env var is unset, not a fallback default',
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
