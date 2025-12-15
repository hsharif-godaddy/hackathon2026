#!/usr/bin/env tsx
/**
 * View conversation summaries for an app in a formatted way
 * 
 * Usage: pnpm view:summaries <appId> [options]
 * 
 * Options:
 *   --latest       Show only the most recent summary
 *   --verbose      Show full summary text (default: truncated)
 *   --json         Output as JSON
 *   --stats        Show statistics only
 */

import { getDatabase } from '../src/database/connection.js';
import { initializeSchema } from '../src/database/schema.js';
import { SummaryRepository } from '../src/database/repositories/SummaryRepository.js';
import { AppRepository } from '../src/database/repositories/AppRepository.js';
import { ConversationRepository } from '../src/database/repositories/ConversationRepository.js';
import { Logger } from '../src/logging/index.js';
import type { ConversationSummary } from '../src/database/schema.js';

const logger = Logger.create({ service: 'view-summaries' });

const args = process.argv.slice(2);
const appId = args.find(arg => !arg.startsWith('--'));
const showLatest = args.includes('--latest');
const verbose = args.includes('--verbose');
const jsonOutput = args.includes('--json');
const statsOnly = args.includes('--stats');

if (!appId) {
  console.error('Usage: pnpm view:summaries <appId> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --latest       Show only the most recent summary');
  console.error('  --verbose      Show full summary text (default: truncated to 200 chars)');
  console.error('  --json         Output as JSON');
  console.error('  --stats        Show statistics only');
  console.error('');
  console.error('Examples:');
  console.error('  pnpm view:summaries fb11112b-0747-482b-93e5-a3ec1dd574a1');
  console.error('  pnpm view:summaries fb11112b-0747-482b-93e5-a3ec1dd574a1 --latest');
  console.error('  pnpm view:summaries fb11112b-0747-482b-93e5-a3ec1dd574a1 --verbose');
  console.error('  pnpm view:summaries fb11112b-0747-482b-93e5-a3ec1dd574a1 --json');
  console.error('  pnpm view:summaries fb11112b-0747-482b-93e5-a3ec1dd574a1 --stats');
  process.exit(1);
}

function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function calculateCompressionRatio(summary: ConversationSummary): number {
  if (summary.originalTokenCount === 0) return 0;
  return (summary.summaryTokenCount / summary.originalTokenCount) * 100;
}

function calculateTokenSavings(summary: ConversationSummary): number {
  return summary.originalTokenCount - summary.summaryTokenCount;
}

function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function formatSummary(summary: ConversationSummary, index: number, total: number): void {
  const compressionRatio = calculateCompressionRatio(summary);
  const tokenSavings = calculateTokenSavings(summary);
  const compressionPercent = (100 - compressionRatio).toFixed(1);

  console.log('');
  console.log('═'.repeat(80));
  console.log(`Summary ${index + 1} of ${total}`);
  console.log('═'.repeat(80));
  console.log('');
  
  console.log('📋 Summary Details:');
  console.log(`   ID:                ${summary.id}`);
  console.log(`   Created:           ${formatDate(summary.createdAt)}`);
  if (summary.conversationId) {
    console.log(`   Conversation ID:   ${summary.conversationId}`);
  }
  console.log('');
  
  console.log('📊 Statistics:');
  console.log(`   Messages:          ${summary.messageCount} messages`);
  console.log(`   Message Range:     ${summary.messageRangeStart.substring(0, 8)}... → ${summary.messageRangeEnd.substring(0, 8)}...`);
  console.log(`   Original Tokens:   ${summary.originalTokenCount.toLocaleString()} tokens`);
  console.log(`   Summary Tokens:    ${summary.summaryTokenCount.toLocaleString()} tokens`);
  console.log(`   Token Savings:     ${tokenSavings.toLocaleString()} tokens (${compressionPercent}% reduction)`);
  console.log(`   Compression Ratio: ${compressionRatio.toFixed(1)}%`);
  console.log(`   Model Used:        ${summary.modelUsed}`);
  console.log('');
  
  console.log('📝 Summary Text:');
  console.log('─'.repeat(80));
  
  if (verbose) {
    // Show full text with proper formatting
    const lines = summary.summaryText.split('\n');
    lines.forEach(line => {
      console.log(`   ${line}`);
    });
  } else {
    // Show truncated text
    const truncated = truncateText(summary.summaryText, 200);
    const lines = truncated.split('\n');
    lines.forEach(line => {
      console.log(`   ${line}`);
    });
    
    if (summary.summaryText.length > 200) {
      console.log('');
      console.log('   [Use --verbose to see full summary text]');
    }
  }
  
  console.log('─'.repeat(80));
}

function formatStats(summaries: ConversationSummary[]): void {
  if (summaries.length === 0) {
    console.log('\n📊 No summaries found for this app.\n');
    return;
  }

  const totalMessages = summaries.reduce((sum, s) => sum + s.messageCount, 0);
  const totalOriginalTokens = summaries.reduce((sum, s) => sum + s.originalTokenCount, 0);
  const totalSummaryTokens = summaries.reduce((sum, s) => sum + s.summaryTokenCount, 0);
  const totalSavings = totalOriginalTokens - totalSummaryTokens;
  const avgCompressionRatio = summaries.reduce((sum, s) => sum + calculateCompressionRatio(s), 0) / summaries.length;
  const overallCompressionPercent = 100 - avgCompressionRatio;

  console.log('');
  console.log('═'.repeat(80));
  console.log('Summary Statistics');
  console.log('═'.repeat(80));
  console.log('');
  
  console.log('📊 Overall Stats:');
  console.log(`   Total Summaries:        ${summaries.length}`);
  console.log(`   Total Messages:         ${totalMessages.toLocaleString()}`);
  console.log(`   Avg Messages/Summary:   ${(totalMessages / summaries.length).toFixed(1)}`);
  console.log('');
  
  console.log('💾 Token Usage:');
  console.log(`   Original Tokens:        ${totalOriginalTokens.toLocaleString()}`);
  console.log(`   Summary Tokens:         ${totalSummaryTokens.toLocaleString()}`);
  console.log(`   Total Savings:          ${totalSavings.toLocaleString()} tokens`);
  console.log(`   Avg Compression:        ${overallCompressionPercent.toFixed(1)}% reduction`);
  console.log('');
  
  console.log('📈 Per-Summary Breakdown:');
  console.log('');
  console.log('   #  | Messages | Original  | Summary  | Savings  | Reduction | Created');
  console.log('   ' + '─'.repeat(76));
  
  summaries.forEach((summary, index) => {
    const savings = calculateTokenSavings(summary);
    const reduction = (100 - calculateCompressionRatio(summary)).toFixed(0);
    const date = formatDate(summary.createdAt).split(',')[0]; // Just the date part
    
    console.log(
      `   ${(index + 1).toString().padStart(2)} | ` +
      `${summary.messageCount.toString().padStart(8)} | ` +
      `${formatTokens(summary.originalTokenCount).padStart(9)} | ` +
      `${formatTokens(summary.summaryTokenCount).padStart(8)} | ` +
      `${formatTokens(savings).padStart(8)} | ` +
      `${reduction.padStart(8)}% | ` +
      `${date}`
    );
  });
  
  console.log('');
}

async function main() {
  // Initialize database
  const db = getDatabase();
  initializeSchema(db);

  const appRepo = new AppRepository();
  const summaryRepo = new SummaryRepository();
  const conversationRepo = new ConversationRepository();

  // Verify app exists
  const app = appRepo.findById(appId);
  if (!app) {
    console.error(`\n❌ Error: App with ID "${appId}" not found.\n`);
    process.exit(1);
  }

  // Get summaries
  let summaries: ConversationSummary[];
  
  if (showLatest) {
    const latest = await summaryRepo.findLatestForApp(appId);
    summaries = latest ? [latest] : [];
  } else {
    summaries = await summaryRepo.findByAppId(appId);
  }

  // JSON output
  if (jsonOutput) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }

  // Stats only
  if (statsOnly) {
    formatStats(summaries);
    return;
  }

  // No summaries found
  if (summaries.length === 0) {
    console.log('');
    console.log('═'.repeat(80));
    console.log(`App: ${app.name} (${appId})`);
    console.log('═'.repeat(80));
    console.log('');
    console.log('ℹ️  No summaries found for this app.');
    console.log('');
    console.log('To create a summary, either:');
    console.log('  1. Use the app and send messages (automatic when > 10k tokens)');
    console.log('  2. Manually trigger: pnpm trigger:summarization ' + appId);
    console.log('  3. Test dry-run: pnpm test:summarization ' + appId);
    console.log('');
    return;
  }

  // Header
  console.log('');
  console.log('═'.repeat(80));
  console.log(`App: ${app.name}`);
  console.log(`App ID: ${appId}`);
  console.log('═'.repeat(80));

  // Get conversation count for context
  const conversations = await conversationRepo.getByAppId(appId);
  console.log('');
  console.log(`📁 Total Conversations: ${conversations.length}`);
  console.log(`📝 Total Summaries: ${summaries.length}`);

  // Show summaries
  summaries.forEach((summary, index) => {
    formatSummary(summary, index, summaries.length);
  });

  // Overall stats at the end
  console.log('');
  console.log('═'.repeat(80));
  console.log('Overall Statistics');
  console.log('═'.repeat(80));
  
  const totalOriginalTokens = summaries.reduce((sum, s) => sum + s.originalTokenCount, 0);
  const totalSummaryTokens = summaries.reduce((sum, s) => sum + s.summaryTokenCount, 0);
  const totalSavings = totalOriginalTokens - totalSummaryTokens;
  const overallReduction = ((totalSavings / totalOriginalTokens) * 100).toFixed(1);
  
  console.log('');
  console.log(`   Total Messages Summarized:  ${summaries.reduce((sum, s) => sum + s.messageCount, 0).toLocaleString()}`);
  console.log(`   Total Original Tokens:      ${totalOriginalTokens.toLocaleString()}`);
  console.log(`   Total Summary Tokens:       ${totalSummaryTokens.toLocaleString()}`);
  console.log(`   Total Token Savings:        ${totalSavings.toLocaleString()} (${overallReduction}% reduction)`);
  console.log('');
  console.log('═'.repeat(80));
  console.log('');
}

main().catch((error) => {
  logger.error('view.summaries.failure', {
    error: error instanceof Error ? error.message : String(error),
  });
  console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

