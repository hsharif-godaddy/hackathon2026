import { createDatabaseScenario } from './create-database-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noReturningScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createDatabaseScenario(
    {
      name: 'database-no-returning',
      staticFirstMessage:
        'Add a signup endpoint that creates a user and returns the created user object with their ID',
      goals: [
        {
          description: 'Agent does NOT use .returning() on insert statements',
          assertion: 'positive',
        },
        {
          description: 'Agent uses the insertId pattern: Number(result[0].insertId) followed by a select query',
          assertion: 'positive',
        },
        {
          description: 'Agent returns the full user object (fetched via select after insert)',
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
