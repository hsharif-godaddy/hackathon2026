import { createAuthScenario } from './create-auth-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * User asks to "password protect" a specific page — a common phrasing
 * that should trigger the authentication skill rather than a naive
 * password prompt approach.
 */
export function passwordProtectPageScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createAuthScenario(
    {
      name: 'auth-password-protect-page',
      staticFirstMessage:
        'Build me a small business site with a home page, about page, and an admin dashboard. ' +
        'Password protect the admin dashboard so only I can access it.',
      goals: [
        {
          description:
            'Agent builds the site with home, about, and admin dashboard pages',
          assertion: 'positive',
        },
        {
          description:
            'Agent uses the authentication skill (BetterAuth) to protect the admin page, ' +
            'not a naive inline password check',
          assertion: 'positive',
        },
        {
          description:
            'Admin dashboard is wrapped with ProtectedRoute while home and about remain public',
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
