import { createDatabaseScenario } from './create-database-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function crudApiHandlerScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createDatabaseScenario(
    {
      name: 'database-crud-api-handler',
      staticFirstMessage:
        'Create an API for managing products with name, price, and description. I need endpoints to list, create, update, and delete products.',
      goals: [
        {
          description: 'Agent installs the database skill via skill({ action: "install", skill: "database" })',
          assertion: 'positive',
        },
        {
          description: 'Agent defines a products table in src/server/db/schema.ts',
          assertion: 'positive',
        },
        {
          description: 'Agent creates API route handlers that import db from ../../db/client.js (with .js extension)',
          assertion: 'positive',
        },
        {
          description: 'Agent uses the insertId pattern instead of .returning() for create operations',
          assertion: 'positive',
        },
        {
          description: 'Agent includes error handling in the API routes (try/catch with 500 response)',
          assertion: 'positive',
        },
        {
          description: 'Agent runs generate and migrate to apply the schema',
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
