import { createAuthScenario } from './create-auth-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * User asks for both email/password AND Google OAuth login.
 * Agent should install templates, request all secrets (auth secret +
 * OAuth credentials), configure both emailAndPassword and
 * socialProviders in auth.ts, and set up routes with providers prop.
 */
export function addBothAuthScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createAuthScenario(
    {
      name: 'auth-add-both-email-and-oauth',
      staticFirstMessage:
        'Build me a project management app with a dashboard. ' +
        'I want users to be able to sign up with email and password, ' +
        'but also allow them to sign in with their Google account.',
      goals: [
        {
          description:
            'Agent installs the authentication skill templates',
          assertion: 'positive',
        },
        {
          description:
            'Agent requests BETTER_AUTH_SECRET and Google OAuth credentials (client ID + secret) via requestSecrets',
          assertion: 'positive',
        },
        {
          description:
            'Agent enables both emailAndPassword and socialProviders.google in auth.ts config',
          assertion: 'positive',
        },
        {
          description:
            'Agent sets up login/signup routes with providers prop (e.g. providers={[\'google\']}) on AuthPage',
          assertion: 'positive',
        },
        {
          description:
            'Agent wraps app routes with ProtectedRoute while keeping login/signup public',
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
