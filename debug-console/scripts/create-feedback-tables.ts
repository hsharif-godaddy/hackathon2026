/**
 * create-feedback-tables.ts
 *
 * Provisions the 4 new DynamoDB tables for Feedback + Support sections.
 * Run once per environment (dev and prod separately via SP_ENV env var).
 *
 * Usage:
 *   SP_ENV=dev  AWS_PROFILE=<profile> npx tsx scripts/create-feedback-tables.ts
 *   SP_ENV=prod AWS_PROFILE=<profile> npx tsx scripts/create-feedback-tables.ts
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';

const region = process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-west-2';
const env = process.env.SP_ENV ?? 'dev';

const client = new DynamoDBClient({ region });

interface TableDef {
  name: string;
  pk: string;
  sk?: string;
}

const TABLES: TableDef[] = [
  // Composite feedback rows (one item per unique feedback_id)
  { name: `airo-builde-supportplane-feedback-${env}`, pk: 'feedback_id' },

  // Daily stat rollups: PK = "2026-04-15#prod", SK = app_id
  { name: `airo-builde-supportplane-feedback-stats-${env}`, pk: 'date_env', sk: 'app_id' },

  // Ingestion log: PK = ingest_key (S3 URL or "athena:db.table:YYYY-MM")
  { name: `airo-builde-supportplane-feedback-ingest-${env}`, pk: 'ingest_key' },

  // Support/JIRA tickets. PK = ticket_key. Reserved items hold metadata.
  { name: `airo-builde-supportplane-tickets-${env}`, pk: 'ticket_key' },
];

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch {
    return false;
  }
}

async function createTable(def: TableDef): Promise<void> {
  const attrDefs: Array<{ AttributeName: string; AttributeType: 'S' | 'N' | 'B' }> = [
    { AttributeName: def.pk, AttributeType: 'S' },
  ];
  const keySchema: Array<{ AttributeName: string; KeyType: 'HASH' | 'RANGE' }> = [
    { AttributeName: def.pk, KeyType: 'HASH' },
  ];

  if (def.sk) {
    attrDefs.push({ AttributeName: def.sk, AttributeType: 'S' });
    keySchema.push({ AttributeName: def.sk, KeyType: 'RANGE' });
  }

  try {
    await client.send(
      new CreateTableCommand({
        TableName: def.name,
        AttributeDefinitions: attrDefs,
        KeySchema: keySchema,
        BillingMode: 'PAY_PER_REQUEST',
        Tags: [
          { Key: 'env', Value: env },
          { Key: 'service', Value: 'airo-debug-console' },
          { Key: 'section', Value: 'supportplane' },
        ],
      })
    );
    console.log(`  ✓ Created: ${def.name}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`  ↩ Already exists: ${def.name}`);
    } else {
      throw err;
    }
  }
}

async function main(): Promise<void> {
  console.log(`\nCreating DynamoDB tables for SP_ENV=${env} in region=${region}\n`);

  for (const table of TABLES) {
    const exists = await tableExists(table.name);
    if (exists) {
      console.log(`  ↩ Already exists: ${table.name}`);
    } else {
      await createTable(table);
    }
  }

  console.log('\nDone. Add these to .env.local if using custom table names:\n');
  for (const table of TABLES) {
    const varName = table.name
      .replace(`airo-builde-supportplane-`, 'SP_')
      .replace(`-${env}`, '')
      .toUpperCase()
      .replace(/-/g, '_');
    console.log(`  ${varName}=${table.name}`);
  }
  console.log(`  SP_ENV=${env}`);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
