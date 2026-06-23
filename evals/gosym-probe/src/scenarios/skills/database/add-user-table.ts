import { createDatabaseScenario } from './create-database-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function addUserTableScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createDatabaseScenario(
    {
      name: 'database-add-user-table',
      staticFirstMessage:
        'I need to store user accounts with name, email, and a created date',
      goals: [
        {
          description: 'Agent installs the database skill via skill({ action: "install", skill: "database" })',
          assertion: 'positive',
        },
        {
          description: 'Agent defines a users table in src/server/db/schema.ts with name, email, and createdAt columns',
          assertion: 'positive',
        },
        {
          description: 'Agent runs npx drizzle-kit generate to create a migration',
          assertion: 'positive',
        },
        {
          description: 'Agent runs npx drizzle-kit migrate to apply the migration',
          assertion: 'positive',
        },
        {
          description: 'Agent verifies tables exist using database__listTables',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'database__listTables', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
