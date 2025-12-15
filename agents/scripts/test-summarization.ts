#!/usr/bin/env tsx
/**
 * Test script for conversation summarization
 * 
 * Usage: pnpm test:summarization <appId> [conversationId] [strategy] [tokenThreshold]
 * 
 * This script runs summarization in dry-run mode (doesn't save to database)
 * and outputs the generated summary.
 * 
 * Arguments:
 *   appId          - Required. App ID to summarize conversations for
 *   conversationId - Optional. Specific conversation ID to summarize (if omitted, summarizes all conversations for the app)
 *   strategy       - Optional. Summarization strategy: 'llm' or 'simple' (default: 'llm')
 *   tokenThreshold - Optional. Token threshold to trigger summarization (default: 50000)
 */

import { ConversationRepository } from '../src/database/repositories/ConversationRepository.js';
import { ConversationHistoryLoader } from '../src/services/ConversationHistoryLoader.js';
import { SummaryRepository } from '../src/database/repositories/SummaryRepository.js';
import { LLMSummarizationStrategy } from '../src/services/summarization/LLMSummarizationStrategy.js';
import { DetailedLLMSummarizationStrategy } from '../src/services/summarization/DetailedLLMSummarizationStrategy.js';
import { SimpleSummarizationStrategy } from '../src/services/summarization/SimpleSummarizationStrategy.js';
import { countTokens } from '../src/utils/token-counter.js';
import { AppRepository } from '../src/database/repositories/AppRepository.js';
import type { SummarizationStrategy } from '../src/services/summarization/SummarizationStrategy.js';
import type { LLMMessage, DatabaseMessage } from '../src/services/ConversationHistoryLoader.js';

const appId = process.argv[2];
const conversationId = process.argv[3];
const strategyName = process.argv[4] || 'llm';
const tokenThreshold = process.argv[5] ? parseInt(process.argv[5], 10) : 10000;

if (!appId) {
  console.error('Usage: pnpm test:summarization <appId> [conversationId] [strategy] [tokenThreshold]');
  console.error('');
  console.error('Arguments:');
  console.error('  appId          - Required. App ID to summarize conversations for');
  console.error('  conversationId - Optional. Specific conversation ID to summarize (if omitted, summarizes all conversations)');
  console.error('  strategy       - Optional. Summarization strategy (default: "llm")');
  console.error('                   Options: "llm" (baseline), "detailed-llm" (structured), "simple" (test)');
  console.error('  tokenThreshold - Optional. Token threshold to trigger summarization (default: 10000)');
  console.error('');
  console.error('Examples:');
  console.error('  pnpm test:summarization my-app-id');
  console.error('  pnpm test:summarization my-app-id "" detailed-llm');
  console.error('  pnpm test:summarization my-app-id conv-123 simple');
  console.error('  pnpm test:summarization my-app-id conv-123 llm 30000');
  process.exit(1);
}

/**
 * Convert database messages to LLM messages for token counting
 */
function convertToLLMMessages(dbMessages: DatabaseMessage[]): LLMMessage[] {
  const llmMessages: LLMMessage[] = [];

  for (const dbMsg of dbMessages) {
    if (dbMsg.sender === 'user') {
      llmMessages.push({
        role: 'user',
        content: dbMsg.content,
      });
    } else if (dbMsg.sender === 'agent') {
      if (dbMsg.segments && dbMsg.segments.length > 0) {
        for (const segment of dbMsg.segments) {
          if (segment.type === 'content' && segment.content) {
            llmMessages.push({
              role: 'assistant',
              content: segment.content,
            });
          } else if (segment.type === 'tool_call' && segment.tool_call) {
            if (segment.tool_call.tool_result) {
              llmMessages.push({
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: segment.tool_call.id,
                    type: 'function',
                    function: {
                      name: segment.tool_call.tool_name,
                      arguments: JSON.stringify(segment.tool_call.tool_args || {}),
                    },
                  },
                ],
              });
              llmMessages.push({
                role: 'tool',
                content:
                  typeof segment.tool_call.tool_result === 'string'
                    ? segment.tool_call.tool_result
                    : JSON.stringify(segment.tool_call.tool_result),
                tool_call_id: segment.tool_call.id,
                name: segment.tool_call.tool_name,
              });
            }
          }
        }
      } else {
        llmMessages.push({
          role: 'assistant',
          content: dbMsg.content,
        });
      }
    }
  }

  return llmMessages;
}

/**
 * Serialize LLM message for token counting
 */
function serializeMessage(message: LLMMessage): string {
  let serialized = message.content || '';

  if (message.tool_calls && message.tool_calls.length > 0) {
    serialized += '\n[Tool Calls]\n';
    for (const toolCall of message.tool_calls) {
      serialized += `${toolCall.function.name}: ${toolCall.function.arguments}\n`;
    }
  }

  if (message.role === 'tool') {
    serialized += `\n[Tool Result: ${message.name}]\n${message.content}`;
  }

  return serialized;
}

async function main() {
  console.log('='.repeat(80));
  console.log('Conversation Summarization Test (Dry-Run Mode)');
  console.log('='.repeat(80));
  console.log(`App ID: ${appId}`);
  if (conversationId) {
    console.log(`Conversation ID: ${conversationId}`);
  } else {
    console.log(`Conversation ID: All conversations for app`);
  }
  console.log(`Strategy: ${strategyName}`);
  console.log(`Token Threshold: ${tokenThreshold}`);
  console.log('');

  // Initialize repositories
  const conversationRepo = new ConversationRepository();
  const summaryRepo = new SummaryRepository();
  const appRepo = new AppRepository();

  // Check if app exists
  const app = appRepo.findById(appId);
  if (!app) {
    console.error(`❌ Error: App with ID "${appId}" not found`);
    process.exit(1);
  }

  console.log(`✓ App found: ${app.name}`);
  console.log('');

  // Load conversations
  let conversations;
  if (conversationId) {
    // Load specific conversation
    const conversation = await conversationRepo.getById(conversationId);
    if (!conversation) {
      console.error(`❌ Error: Conversation with ID "${conversationId}" not found`);
      process.exit(1);
    }
    if (conversation.appId !== appId) {
      console.error(`❌ Error: Conversation "${conversationId}" does not belong to app "${appId}"`);
      process.exit(1);
    }
    conversations = [conversation];
    console.log(`✓ Found conversation: ${conversationId}`);
  } else {
    // Load all conversations for the app
    conversations = await conversationRepo.getByAppId(appId);
    if (conversations.length === 0) {
      console.log(`⚠️  No conversations found for app "${appId}"`);
      process.exit(0);
    }
    console.log(`✓ Found ${conversations.length} conversation(s) for app`);
  }
  console.log('');

  // Load all messages
  const allMessages: DatabaseMessage[] = [];
  for (const conversation of conversations) {
    const messages = await conversationRepo.getMessagesForHistory(conversation.id);
    allMessages.push(
      ...messages.map((msg) => ({
        ...msg,
        conversationId: conversation.id,
      }))
    );
  }

  allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (allMessages.length === 0) {
    console.log(`⚠️  No messages found in conversations`);
    process.exit(0);
  }

  console.log(`✓ Loaded ${allMessages.length} message(s)`);
  console.log('');

  // Convert to LLM messages and count tokens
  const llmMessages = convertToLLMMessages(allMessages);
  const modelName = 'claude-3-5-sonnet';
  let totalTokens = 0;
  for (const msg of llmMessages) {
    const serialized = serializeMessage(msg);
    const result = countTokens(serialized, modelName);
    totalTokens += result.tokenCount;
  }

  console.log(`📊 Token Statistics:`);
  console.log(`   Total messages: ${llmMessages.length}`);
  console.log(`   Total tokens: ${totalTokens.toLocaleString()}`);
  console.log(`   Token threshold: ${tokenThreshold.toLocaleString()}`);
  console.log(`   Exceeds threshold: ${totalTokens > tokenThreshold ? '✓ Yes' : '✗ No'}`);
  console.log('');

  // Check if summarization is needed
  if (totalTokens <= tokenThreshold) {
    console.log('ℹ️  Token count is below threshold. Summarization would not be triggered.');
    console.log('   To test summarization anyway, use a lower threshold.');
    console.log('');
  }

  // Get existing summary if any
  const existingSummary = await summaryRepo.findLatestForApp(appId);
  if (existingSummary) {
    console.log(`📝 Existing Summary Found:`);
    console.log(`   Summary ID: ${existingSummary.id}`);
    console.log(`   Message Range: ${existingSummary.messageRangeStart} → ${existingSummary.messageRangeEnd}`);
    console.log(`   Messages Summarized: ${existingSummary.messageCount}`);
    console.log(`   Original Tokens: ${existingSummary.originalTokenCount.toLocaleString()}`);
    console.log(`   Summary Tokens: ${existingSummary.summaryTokenCount.toLocaleString()}`);
    console.log(`   Compression Ratio: ${(existingSummary.summaryTokenCount / existingSummary.originalTokenCount).toFixed(2)}`);
    console.log(`   Model Used: ${existingSummary.modelUsed}`);
    console.log('');
    console.log(`   Summary Text:`);
    console.log(`   ${'-'.repeat(76)}`);
    console.log(`   ${existingSummary.summaryText.split('\n').join('\n   ')}`);
    console.log(`   ${'-'.repeat(76)}`);
    console.log('');
  } else {
    console.log('ℹ️  No existing summary found. This will be an initial summarization.');
    console.log('');
  }

  // Select strategy
  let strategy: SummarizationStrategy;
  switch (strategyName) {
    case 'simple':
      strategy = new SimpleSummarizationStrategy();
      console.log('✓ Using SimpleSummarizationStrategy (non-LLM, for testing)');
      break;
    case 'detailed-llm':
      strategy = new DetailedLLMSummarizationStrategy();
      console.log('✓ Using DetailedLLMSummarizationStrategy (structured LLM-based with API/DB/Pages sections)');
      break;
    case 'llm':
    default:
      strategy = new LLMSummarizationStrategy();
      console.log('✓ Using LLMSummarizationStrategy (baseline LLM-based)');
      break;
  }
  console.log('');

  // Determine message range to summarize
  let messagesToSummarize: LLMMessage[];
  let startMessageId: string;
  let endMessageId: string;

  if (existingSummary) {
    // Incremental: find messages after the last summarized message
    const lastSummaryEndIndex = allMessages.findIndex(
      (msg) => msg.id === existingSummary.messageRangeEnd
    );

    if (lastSummaryEndIndex === -1 || lastSummaryEndIndex >= allMessages.length - 1) {
      console.log('⚠️  No new messages to summarize after existing summary');
      process.exit(0);
    }

    const newMessages = allMessages.slice(lastSummaryEndIndex + 1);
    messagesToSummarize = convertToLLMMessages(newMessages);
    startMessageId = newMessages[0]?.id || '';
    endMessageId = newMessages[newMessages.length - 1]?.id || '';

    console.log(`📋 Incremental Summarization:`);
    console.log(`   Messages to summarize: ${messagesToSummarize.length} (after existing summary)`);
  } else {
    // Initial: summarize oldest messages until we're under threshold
    let accumulatedTokens = 0;
    let cutoffIndex = 0;

    for (let i = 0; i < llmMessages.length; i++) {
      const msg = llmMessages[i];
      if (!msg) continue;
      const serialized = serializeMessage(msg);
      const result = countTokens(serialized, modelName);
      accumulatedTokens += result.tokenCount;

      if (accumulatedTokens > tokenThreshold && i > 0) {
        cutoffIndex = i;
        break;
      }
    }

    if (cutoffIndex === 0) {
      console.log('⚠️  Cannot summarize - all messages exceed threshold');
      process.exit(0);
    }

    messagesToSummarize = llmMessages.slice(0, cutoffIndex);
    startMessageId = allMessages[0]?.id || '';
    endMessageId = allMessages[cutoffIndex - 1]?.id || '';

    console.log(`📋 Initial Summarization:`);
    console.log(`   Messages to summarize: ${messagesToSummarize.length} (oldest messages)`);
  }

  // Count tokens for messages to summarize
  let summaryTokenCount = 0;
  for (const msg of messagesToSummarize) {
    const serialized = serializeMessage(msg);
    const result = countTokens(serialized, modelName);
    summaryTokenCount += result.tokenCount;
  }

  console.log(`   Tokens to summarize: ${summaryTokenCount.toLocaleString()}`);
  console.log('');

  // Perform summarization (dry-run)
  console.log('🔄 Generating summary...');
  console.log('');

  try {
    const summaryResult = await strategy.summarize({
      appId,
      messages: messagesToSummarize,
      existingSummary: existingSummary?.summaryText,
      messageRange: {
        startId: startMessageId,
        endId: endMessageId,
      },
      originalTokenCount: summaryTokenCount,
    });

    console.log('='.repeat(80));
    console.log('SUMMARY RESULT (Dry-Run)');
    console.log('='.repeat(80));
    console.log('');
    console.log(`Summary ID: ${summaryResult.messageRange.startId} → ${summaryResult.messageRange.endId}`);
    console.log(`Messages Summarized: ${summaryResult.messageCount}`);
    console.log(`Original Token Count: ${summaryResult.originalTokenCount.toLocaleString()}`);
    console.log(`Summary Token Count: ${summaryResult.summaryTokenCount.toLocaleString()}`);
    console.log(`Compression Ratio: ${(summaryResult.summaryTokenCount / summaryResult.originalTokenCount).toFixed(2)}`);
    console.log(`Tokens Saved: ${(summaryResult.originalTokenCount - summaryResult.summaryTokenCount).toLocaleString()}`);
    console.log(`Model Used: ${summaryResult.modelUsed}`);
    console.log('');
    console.log('Summary Text:');
    console.log('='.repeat(80));
    console.log(summaryResult.summaryText);
    console.log('='.repeat(80));
    console.log('');
    console.log('ℹ️  This was a dry-run. No changes were saved to the database.');
    console.log('');
  } catch (error) {
    console.error('❌ Error during summarization:');
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

