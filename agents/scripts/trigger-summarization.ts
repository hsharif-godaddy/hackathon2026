#!/usr/bin/env tsx
/**
 * Manually trigger background summarization for an app
 * 
 * Usage: pnpm trigger:summarization <appId>
 */

import { getDatabase } from '../src/database/connection.js';
import { initializeSchema } from '../src/database/schema.js';
import { initializeBackgroundSummarization } from '../src/services/summarization/index.js';
import { Logger } from '../src/logging/index.js';

const logger = Logger.create({ service: 'trigger-summarization' });

const appId = process.argv[2];

if (!appId) {
  console.error('Usage: pnpm trigger:summarization <appId>');
  console.error('');
  console.error('Example:');
  console.error('  pnpm trigger:summarization fb11112b-0747-482b-93e5-a3ec1dd574a1');
  process.exit(1);
}

async function main() {
  // Initialize database
  const db = getDatabase();
  initializeSchema(db);

  console.log(`\n🚀 Triggering background summarization for app: ${appId}\n`);

  // Initialize background summarization system with aggressive settings
  const backgroundSummarizer = await initializeBackgroundSummarization({
    tokenThreshold: 10000, // Lower threshold for more frequent summarization
    debounceMs: 100, // Short debounce for manual trigger
    modelName: 'claude-3-5-sonnet',
    keepRecentTurns: 3, // Keep last 3 user/assistant turns unsummarized
    strategy: 'detailed-llm', // Use detailed strategy for testing
  });

  console.log('✓ Background summarization initialized');
  console.log('✓ Checking if summarization is needed...\n');

  // Manually trigger summarization
  await backgroundSummarizer.checkAndSummarize(appId);

  // Wait for debounce to complete
  await new Promise(resolve => setTimeout(resolve, 200));

  console.log('\n✓ Summarization check complete');
  console.log('\nCheck the database for new summaries:');
  console.log(`  litecli -e "SELECT id, message_count, original_token_count, summary_token_count, model_used FROM conversation_summaries WHERE app_id = '${appId}'" data/apps.db`);
}

main().catch((error) => {
  logger.error('trigger.summarization.failure', {
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

