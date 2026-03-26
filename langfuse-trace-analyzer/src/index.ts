import node_process from 'node:process';

import { load } from './config.js';
import * as esClient from './es-client.js';
import * as langfuseClient from './langfuse-client.js';
import { definitions } from './queries.js';
import { filterResponse, mergeAll } from './transform.js';

function parseDays(args: string[]): number {
  const idx = args.indexOf('--days');
  if (idx === -1 || idx + 1 >= args.length) return 1;
  const val = parseInt(args[idx + 1], 10);
  if (isNaN(val) || val < 1) {
    throw new Error(`Invalid --days value: ${args[idx + 1]}`);
  }
  return val;
}

function dayRange(daysAgo: number): { fromTimestamp: string; toTimestamp: string; label: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() - (daysAgo - 1));

  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 1);

  return {
    fromTimestamp: from.toISOString(),
    toTimestamp: to.toISOString(),
    label: from.toISOString().slice(0, 10),
  };
}

async function main(): Promise<void> {
  const days = parseDays(node_process.argv);
  console.log('Langfuse Metrics Ingest: processing %d day(s)', days);

  const config = load();
  const query = langfuseClient.create(config);
  const es = esClient.create(config);

  await es.ensureIndex();

  let totalDocs = 0;

  for (let d = days; d >= 1; d--) {
    const { fromTimestamp, toTimestamp, label } = dayRange(d);
    console.log('\n--- %s ---', label);

    const responses = new Map<string, langfuseClient.MetricsResponse>();

    for (const def of definitions) {
      try {
        const raw = await query(def.build({ fromTimestamp, toTimestamp }));
        const filtered = filterResponse(raw);
        responses.set(def.metricType, filtered);
        console.log('  %s: %d rows', def.name, filtered.data.length);
      } catch (err) {
        console.error('  %s: FAILED -', def.name, err instanceof Error ? err.message : err);
      }
    }

    const docs = mergeAll(fromTimestamp, responses);
    console.log('  merged: %d documents', docs.length);

    if (docs.length > 0) {
      const indexed = await es.bulk(docs);
      totalDocs += indexed;
      console.log('  indexed: %d documents', indexed);
    }
  }

  console.log('\nDone. Total documents indexed: %d', totalDocs);
}

main().catch(function fatal(err) {
  console.error('Fatal error:', err);
  node_process.exit(1);
});
