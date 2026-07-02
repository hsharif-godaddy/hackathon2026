import { createAuthScenario } from './create-auth-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

/**
 * The authentication skill requires the database skill to be installed
 * first. This scenario verifies the agent handles the prerequisite
 * correctly — either installing DB first or recognizing it's needed.
 */
export function databasePrerequisiteScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createAuthScenario(
    {
      name: 'auth-database-prerequisite',
      staticFirstMessage:
        'Add user login to my app so people can create accounts and sign in.',
      goals: [
        {
          description:
            'Agent installs or verifies the database skill before setting up authentication',
          assertion: 'positive',
        },
        {
          description:
            'Agent installs the authentication skill templates',
          assertion: 'positive',
        },
        {
          description:
            'Agent adds the auth database schema (user, session, account, verification tables)',
          assertion: 'positive',
        },
        {
          description:
            'Agent runs db:generate and db:migrate after adding the schema',
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
