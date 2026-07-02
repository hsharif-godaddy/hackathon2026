import { createAuthScenario } from './create-auth-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * Happy path: user asks for email/password login on a fresh app.
 * Agent should install the skill, request secrets, configure auth.ts,
 * set up routes with ProtectedRoute, and add the DB schema.
 */
export function addEmailAuthScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createAuthScenario(
    {
      name: 'auth-add-email-password',
      goals: [
        {
          description: 'Build a simple portfolio site with a home page and about page',
          assertion: 'positive',
        },
        {
          description:
            'Add login and signup so only registered users can see the site — use email and password',
          assertion: 'positive',
        },
        {
          description:
            'Agent installs the authentication skill templates before configuring auth',
          assertion: 'positive',
        },
        {
          description:
            'Agent requests BETTER_AUTH_SECRET via requestSecrets',
          assertion: 'positive',
        },
        {
          description:
            'Agent wraps protected routes with ProtectedRoute and keeps login/signup public',
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
