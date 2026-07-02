import { createAuthScenario } from './create-auth-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * User asks for Google OAuth login. Agent should install templates,
 * request OAuth credentials + auth secret, configure socialProviders,
 * and set up the OAuth callback URL guidance.
 */
export function addOAuthAuthScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createAuthScenario(
    {
      name: 'auth-add-oauth-google',
      goals: [
        {
          description: 'Build a simple recipe sharing site',
          assertion: 'positive',
        },
        {
          description:
            'Add Google login so users can sign in with their Google account',
          assertion: 'positive',
        },
        {
          description:
            'Agent requests Google OAuth credentials (client ID and secret) via requestSecrets',
          assertion: 'positive',
        },
        {
          description:
            'Agent configures socialProviders.google in auth.ts with getSecret calls',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT create custom auth context providers or auth-context.tsx files',
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
