#!/usr/bin/env tsx
/**
 * CLI for generating derived insights from transcripts
 *
 * Usage:
 *   pnpm insights:bugs --days=30
 *   pnpm insights:features --days=30
 *   pnpm insights:patterns --days=30
 *   pnpm insights:all --days=30
 */

import { generateBugInsights } from '../src/lib/insights/generate-bugs';
import { generateFeatureInsights } from '../src/lib/insights/generate-features';
import { generateFrictionPatterns } from '../src/lib/insights/generate-patterns';
import { logger } from '../src/lib/logger';

async function main(): Promise<void> {
  const args: string[] = process.argv.slice(2);
  const command: string = args[0] || 'all';

  // Parse --days argument
  const daysArg: string | undefined = args.find(a => a.startsWith('--days'));
  let days = 30;
  if (daysArg) {
    const value: string = daysArg.split('=')[1];
    days = parseInt(value, 10);
    if (isNaN(days) || days < 1) {
      console.error('Invalid --days value. Must be a positive integer.');
      process.exit(1);
    }
  }

  logger.info('insights.cli.start', { command, days });

  try {
    switch (command) {
      case 'bugs':
        await generateBugInsights(days);
        break;

      case 'features':
        await generateFeatureInsights(days);
        break;

      case 'patterns':
        await generateFrictionPatterns(days);
        break;

      case 'all':
        await Promise.all([
          generateBugInsights(days),
          generateFeatureInsights(days),
          generateFrictionPatterns(days),
        ]);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: pnpm insights:{bugs|features|patterns|all} [--days=30]');
        process.exit(1);
    }

    logger.info('insights.cli.complete', { command, days });
    process.exit(0);
  } catch (error) {
    logger.error('insights.cli.failed', {
      error: error instanceof Error ? error.message : String(error),
      command,
      days,
    });
    process.exit(1);
  }
}

main();
