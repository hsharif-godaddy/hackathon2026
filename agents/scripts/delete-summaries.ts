#!/usr/bin/env tsx
/**
 * Delete conversation summaries for an app
 * 
 * Usage: pnpm delete:summaries <appId> [--last]
 * 
 * This script deletes summaries for the specified app from the database.
 * Use this for testing/development to reset summarization state.
 * 
 * Options:
 *   --last    Delete only the most recent summary (default: delete all)
 */

import { SummaryRepository } from '../src/database/repositories/SummaryRepository.js';

const appId = process.argv[2];
const lastOnly = process.argv.includes('--last');

if (!appId || appId.startsWith('--')) {
  console.error('Usage: pnpm delete:summaries <appId> [--last]');
  console.error('');
  console.error('Deletes conversation summaries for the specified app.');
  console.error('');
  console.error('Options:');
  console.error('  --last    Delete only the most recent summary');
  process.exit(1);
}

async function deleteSummaries() {
  const summaryRepo = new SummaryRepository();

  console.log(`\n🔍 Checking for summaries for app: ${appId}\n`);

  const allSummaries = await summaryRepo.findByAppId(appId);

  if (allSummaries.length === 0) {
    console.log('No summaries found for this app.\n');
    return;
  }

  const summariesToDelete = lastOnly 
    ? [allSummaries[allSummaries.length - 1]]
    : allSummaries;

  if (lastOnly) {
    console.log(`Found ${allSummaries.length} total summary(ies), deleting most recent:\n`);
  } else {
    console.log(`Found ${allSummaries.length} summary(ies):\n`);
  }
  
  for (const summary of summariesToDelete) {
    console.log(`  - ID: ${summary.id}`);
    console.log(`    Messages: ${summary.messageCount}`);
    console.log(`    Tokens: ${summary.originalTokenCount} → ${summary.summaryTokenCount}`);
    console.log(`    Created: ${summary.createdAt}`);
    console.log('');
  }

  console.log('🗑️  Deleting summaries...\n');

  for (const summary of summariesToDelete) {
    await summaryRepo.deleteById(summary.id);
    console.log(`  ✓ Deleted summary ${summary.id}`);
  }

  console.log(`\n✅ Deleted ${summariesToDelete.length} summary(ies) for app ${appId}\n`);
}

deleteSummaries().catch((error) => {
  console.error('Error deleting summaries:', error);
  process.exit(1);
});
