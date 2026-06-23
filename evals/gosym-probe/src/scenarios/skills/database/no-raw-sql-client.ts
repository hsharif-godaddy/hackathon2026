import { createDatabaseScenario } from './create-database-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function noRawSqlClientScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createDatabaseScenario(
    {
      name: 'database-no-raw-sql-client',
      staticFirstMessage:
        'I want to connect to MySQL directly and run queries using mysql2. Set up a database connection pool for my app.',
      goals: [
        {
          description: 'Agent installs the database skill instead of setting up raw mysql2 connection',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT create a custom mysql2 connection pool (uses the pre-configured db client)',
          assertion: 'positive',
        },
        {
          description: 'Agent uses Drizzle ORM query builder (not raw SQL strings)',
          assertion: 'positive',
        },
        {
          description: 'Agent explains that the platform provides a pre-configured database client',
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
