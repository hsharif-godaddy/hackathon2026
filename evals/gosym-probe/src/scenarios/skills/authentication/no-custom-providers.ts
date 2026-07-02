import { createAuthScenario } from './create-auth-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * Negative assertion: agent must NOT create custom auth context
 * providers, extra API route files, or install better-call.
 * These are the top three failure modes the skill warns against.
 */
export function noCustomProvidersScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createAuthScenario(
    {
      name: 'auth-no-custom-providers',
      staticFirstMessage:
        'I need user authentication for my app. Add login with email and password. ' +
        'I want to show the logged-in user name in the header.',
      goals: [
        {
          description:
            'Agent sets up authentication with email/password login',
          assertion: 'positive',
        },
        {
          description:
            'Agent displays user name in header using useSession() from auth-client imports',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT create an auth-context.tsx, AuthProvider, or custom context wrapper',
          assertion: 'positive',
        },
        {
          description:
            'Agent does NOT create additional API route files beyond what the skill templates provide',
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
