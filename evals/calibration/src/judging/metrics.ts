import path from 'node:path';

import { writeJudgingMetrics } from './aggregate.js';

async function main(): Promise<void> {
  const datasetDir = process.argv.includes('--dataset-dir')
    ? path.resolve(process.argv[process.argv.indexOf('--dataset-dir') + 1] ?? 'dataset')
    : path.resolve('dataset');

  await writeJudgingMetrics({ datasetDir });
}

await main();

