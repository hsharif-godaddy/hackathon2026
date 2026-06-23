import { createDatabaseScenario } from './create-database-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

export function foreignKeyRelationshipScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createDatabaseScenario(
    {
      name: 'database-foreign-key-relationship',
      staticFirstMessage:
        'I have a blog app. I need posts that belong to authors. Each post should have a title, content, and reference back to the author who wrote it.',
      goals: [
        {
          description: 'Agent installs the database skill via skill({ action: "install", skill: "database" })',
          assertion: 'positive',
        },
        {
          description: 'Agent defines both an authors/users table and a posts table in schema.ts',
          assertion: 'positive',
        },
        {
          description: 'Agent uses .references(() => authors.id) or equivalent foreign key syntax on the posts table',
          assertion: 'positive',
        },
        {
          description: 'Agent demonstrates a JOIN query to fetch posts with their author',
          assertion: 'positive',
        },
        {
          description: 'Agent runs generate and migrate after defining the schema',
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
