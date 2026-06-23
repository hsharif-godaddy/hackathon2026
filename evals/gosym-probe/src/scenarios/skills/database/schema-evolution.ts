import { createDatabaseScenario } from './create-database-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function schemaEvolutionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createDatabaseScenario(
    {
      name: 'database-schema-evolution',
      staticFirstMessage:
        'I already have a users table. I need to add an avatar_url column and a phone number field to it.',
      goals: [
        {
          description: 'Agent adds new columns as nullable or with a .default() value (safe for existing rows)',
          assertion: 'positive',
        },
        {
          description: 'Agent does NOT add a NOT NULL column without a default to an existing table',
          assertion: 'positive',
        },
        {
          description: 'Agent runs npx drizzle-kit generate after modifying the schema',
          assertion: 'positive',
        },
        {
          description: 'Agent runs npx drizzle-kit migrate to apply the migration',
          assertion: 'positive',
        },
        {
          description: 'Agent verifies the change succeeded (via database__getSchema or database__listTables)',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'skill', called: true },
        { tool: 'database__getSchema', called: true },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
