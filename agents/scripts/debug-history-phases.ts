#!/usr/bin/env tsx
/**
 * Debug utility for conversation history processing
 *
 * Usage: pnpm debug:history <appId> <agentId> [phase] [maxTokens] [modelName]
 *
 * Phases:
 *   db          - Show raw database messages
 *   llm         - Show converted LLM messages (default)
 *   compressed  - Show compressed LLM messages
 *   limited     - Show token-limited LLM messages
 *   all         - Show all phases
 */

import { ConversationRepository } from '../src/database/repositories/ConversationRepository.js';
import { ConversationHistoryLoader } from '../src/services/ConversationHistoryLoader.js';
import {
  DuplicateFileReadStrategy,
} from '../src/services/compression/strategies/index.js';

const appId = process.argv[2];
const agentId = process.argv[3];
const phase = process.argv[4] || 'llm';
const maxTokens = process.argv[5] ? parseInt(process.argv[5], 10) : 40000;
const modelName = process.argv[6] || 'claude-sonnet-4-6';

if (!appId || !agentId) {
  console.error('Usage: pnpm debug:history <appId> <agentId> [phase] [maxTokens] [modelName]');
  console.error('');
  console.error('Arguments:');
  console.error('  appId      - Required. App ID to query');
  console.error('  agentId    - Required. Agent ID (e.g., "develop")');
  console.error('  phase      - Optional. Which phase to dump (default: llm)');
  console.error('  maxTokens  - Optional. Token limit for limited phase (default: 40000)');
  console.error('  modelName  - Optional. Model name for token counting (default: claude-sonnet-4-6)');
  console.error('');
  console.error('Phases:');
  console.error('  db          - Show raw database messages');
  console.error('  llm         - Show converted LLM messages');
  console.error('  compressed  - Show compressed LLM messages');
  console.error('  limited     - Show token-limited LLM messages');
  console.error('  all         - Show all phases');
  console.error('');
  console.error('Examples:');
  console.error('  pnpm debug:history fb11112b-0747-482b-93e5-a3ec1dd574a1 develop');
  console.error('  pnpm debug:history fb11112b-0747-482b-93e5-a3ec1dd574a1 develop db');
  console.error('  pnpm debug:history fb11112b-0747-482b-93e5-a3ec1dd574a1 develop compressed');
  console.error('  pnpm debug:history fb11112b-0747-482b-93e5-a3ec1dd574a1 develop limited 10000');
  console.error('  pnpm debug:history fb11112b-0747-482b-93e5-a3ec1dd574a1 develop all');
  process.exit(1);
}

if (!['db', 'llm', 'compressed', 'limited', 'all'].includes(phase)) {
  console.error(`Invalid phase: ${phase}`);
  console.error('Valid phases: db, llm, compressed, limited, all');
  process.exit(1);
}

/**
 * Format database message for display
 */
function formatDatabaseMessage(msg: any, index: number): void {
  console.log(`\n--- DB Message ${index + 1} ---`);
  console.log(`ID: ${msg.id}`);
  console.log(`Conversation ID: ${msg.conversationId}`);
  console.log(`Sender: ${msg.sender}`);
  console.log(`Created At: ${msg.createdAt.toISOString()}`);
  console.log(`Content Length: ${msg.content?.length || 0} chars`);

  if (msg.sender === 'user') {
    const preview = msg.content?.substring(0, 500) || '';
    console.log(`Content: ${preview}${msg.content?.length > 500 ? '...' : ''}`);
  } else if (msg.segments && msg.segments.length > 0) {
    console.log(`Segments: ${msg.segments.length}`);
    msg.segments.forEach((segment: any, segIdx: number) => {
      console.log(`  [${segIdx + 1}] Type: ${segment.type}`);
      if (segment.type === 'content') {
        const preview = segment.content?.substring(0, 200) || '';
        console.log(`      Content: ${preview}${segment.content?.length > 200 ? '...' : ''}`);
      } else if (segment.type === 'tool_call') {
        if (segment.tool_call) {
          console.log(`      Tool: ${segment.tool_call.tool_name}`);
          console.log(`      Tool ID: ${segment.tool_call.id}`);
          console.log(`      Has Result: ${!!segment.tool_call.tool_result}`);
          if (segment.tool_call.tool_result) {
            const resultStr = typeof segment.tool_call.tool_result === 'string'
              ? segment.tool_call.tool_result
              : JSON.stringify(segment.tool_call.tool_result);
            const resultPreview = resultStr.substring(0, 200);
            console.log(`      Result Preview: ${resultPreview}${resultStr.length > 200 ? '...' : ''}`);
          }
        } else {
          console.log(`      ⚠️  MISSING tool_call data!`);
          console.log(`      Raw segment:`, JSON.stringify(segment, null, 2).substring(0, 300));
        }
      }
    });
  } else {
    console.log(`⚠️  NO SEGMENTS - Agent message will be skipped in conversion`);
    const preview = msg.content?.substring(0, 500) || '';
    console.log(`Content (ignored): ${preview}${msg.content?.length > 500 ? '...' : ''}`);
  }
}

/**
 * Format LLM message for display
 */
function formatLLMMessage(msg: any, index: number): void {
  console.log(`\n--- LLM Message ${index + 1} ---`);
  console.log(`Role: ${msg.role}`);

  if (msg.role === 'tool') {
    console.log(`Tool Call ID: ${msg.tool_call_id}`);
    console.log(`Tool Name: ${msg.name}`);
  }

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    console.log(`Tool Calls: ${msg.tool_calls.length}`);
    const displayLimit = 5;
    const toolCallsToShow = msg.tool_calls.slice(0, displayLimit);

    toolCallsToShow.forEach((tc: any, tcIdx: number) => {
      console.log(`  [${tcIdx + 1}] ${tc.function.name} (ID: ${tc.id})`);
      const argsPreview = tc.function.arguments.substring(0, 200);
      console.log(`      Args: ${argsPreview}${tc.function.arguments.length > 200 ? '...' : ''}`);
    });

    if (msg.tool_calls.length > displayLimit) {
      const remaining = msg.tool_calls.length - displayLimit;
      const remainingByType = msg.tool_calls.slice(displayLimit).reduce((acc: any, tc: any) => {
        acc[tc.function.name] = (acc[tc.function.name] || 0) + 1;
        return acc;
      }, {});
      console.log(`  ... and ${remaining} more tool calls:`);
      Object.entries(remainingByType).forEach(([name, count]) => {
        console.log(`      ${name}: ${count}`);
      });
    }
  }

  const contentPreview = msg.content?.substring(0, 500) || '';
  console.log(`Content (${msg.content?.length || 0} chars): ${contentPreview}${msg.content?.length > 500 ? '...' : ''}`);
}

/**
 * Main execution function
 */
async function main() {
  console.log('=== Conversation History Debug Utility ===');
  console.log(`App ID: ${appId}`);
  console.log(`Agent ID: ${agentId}`);
  console.log(`Phase: ${phase}`);
  if (phase === 'limited' || phase === 'all') {
    console.log(`Max Tokens: ${maxTokens}`);
    console.log(`Model Name: ${modelName}`);
  }
  console.log('');

  try {
    const conversationRepo = new ConversationRepository();
    const loader = new ConversationHistoryLoader(conversationRepo);

    const duplicateFileReadStrategy = new DuplicateFileReadStrategy();
    loader.registerCompressionStrategy(duplicateFileReadStrategy);

    const dbMessages = await loader.loadDatabaseMessages(appId, agentId);

    if (phase === 'db' || phase === 'all') {
      console.log('\n========================================');
      console.log('PHASE 1: RAW DATABASE MESSAGES');
      console.log('========================================');
      console.log(`Total messages: ${dbMessages.length}`);

      dbMessages.forEach((msg, index) => {
        formatDatabaseMessage(msg, index);
      });

      console.log('\n--- Summary ---');
      const senderCounts = dbMessages.reduce((acc, msg) => {
        acc[msg.sender] = (acc[msg.sender] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('Messages by sender:');
      Object.entries(senderCounts).forEach(([sender, count]) => {
        console.log(`  ${sender}: ${count}`);
      });

      const withSegments = dbMessages.filter(msg => msg.segments && msg.segments.length > 0).length;
      const withoutSegments = dbMessages.filter(msg => msg.sender === 'agent' && (!msg.segments || msg.segments.length === 0)).length;

      const allToolCalls = dbMessages.flatMap(msg =>
        (msg.segments || []).filter(seg => seg.type === 'tool_call')
      );
      const toolCallsWithResults = allToolCalls.filter(seg => seg.tool_call?.tool_result);

      console.log(`\nWith segments: ${withSegments}`);
      console.log(`Without segments (will be skipped): ${withoutSegments}`);
      console.log(`\nTool calls: ${allToolCalls.length}`);
      console.log(`Tool calls with results: ${toolCallsWithResults.length}`);
      console.log(`Tool calls WITHOUT results (will be skipped): ${allToolCalls.length - toolCallsWithResults.length}`);
    }

    if (phase === 'llm' || phase === 'all') {
      const llmMessages = loader.convertToLLMMessages(dbMessages);

      console.log('\n========================================');
      console.log('PHASE 2: CONVERTED LLM MESSAGES (UNCOMPRESSED)');
      console.log('========================================');
      console.log(`Total messages: ${llmMessages.length}`);
      console.log('Note: This shows the raw messages before compression.');
      console.log('');

      llmMessages.forEach((msg, index) => {
        formatLLMMessage(msg, index);
      });

      console.log('\n--- Summary ---');
      const roleCounts = llmMessages.reduce((acc, msg) => {
        acc[msg.role] = (acc[msg.role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('Messages by role:');
      Object.entries(roleCounts).forEach(([role, count]) => {
        console.log(`  ${role}: ${count}`);
      });

      const toolMessages = llmMessages.filter(msg => msg.role === 'tool').length;
      const assistantWithTools = llmMessages.filter(msg => msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0).length;

      console.log(`\nTool messages: ${toolMessages}`);
      console.log(`Assistant messages with tool calls: ${assistantWithTools}`);
    }

    if (phase === 'compressed' || phase === 'all') {
      const llmMessages = loader.convertToLLMMessages(dbMessages);
      const compressor = loader.getCompressor();
      const result = compressor.compressMessages(llmMessages);
      const compressedMessages = result.messages;

      console.log('\n========================================');
      console.log('PHASE 3: COMPRESSED LLM MESSAGES');
      console.log('========================================');
      console.log(`Total messages before compression: ${llmMessages.length}`);
      console.log(`Total messages after compression: ${compressedMessages.length}`);
      console.log(`Messages compressed: ${result.stats.compressedMessages}`);
      console.log(`Original total length: ${result.stats.originalTotalLength} chars`);
      console.log(`Compressed total length: ${result.stats.compressedTotalLength} chars`);
      console.log(`Compression ratio: ${(result.stats.compressionRatio * 100).toFixed(1)}%`);
      console.log(`Savings: ${result.stats.originalTotalLength - result.stats.compressedTotalLength} chars`);
      console.log('');
      console.log('Strategies used:');
      Object.entries(result.stats.strategiesUsed).forEach(([strategy, count]) => {
        console.log(`  ${strategy}: ${count} messages`);
      });
      console.log('');

      console.log('========================================');
      console.log('COMPRESSED MESSAGES (SENT TO LLM):');
      console.log('========================================');

      compressedMessages.forEach((msg, index) => {
        formatLLMMessage(msg, index);
      });

      console.log('\n--- Summary ---');
      const roleCounts = compressedMessages.reduce((acc, msg) => {
        acc[msg.role] = (acc[msg.role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('Messages by role:');
      Object.entries(roleCounts).forEach(([role, count]) => {
        console.log(`  ${role}: ${count}`);
      });

      const toolMessages = compressedMessages.filter(msg => msg.role === 'tool').length;
      const assistantWithTools = compressedMessages.filter(msg => msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0).length;

      console.log(`\nTool messages: ${toolMessages}`);
      console.log(`Assistant messages with tool calls: ${assistantWithTools}`);
    }

    if (phase === 'limited' || phase === 'all') {
      const llmMessages = loader.convertToLLMMessages(dbMessages);
      const compressor = loader.getCompressor();
      const compressionResult = compressor.compressMessages(llmMessages);
      const compressedMessages = compressionResult.messages;

      const limitedMessages = await loader.applyTokenLimit(compressedMessages, maxTokens, modelName);

      console.log('\n========================================');
      console.log('PHASE 4: TOKEN-LIMITED LLM MESSAGES');
      console.log('========================================');
      console.log(`Max Tokens: ${maxTokens}`);
      console.log(`Model Name: ${modelName}`);
      console.log(`Total messages before compression: ${llmMessages.length}`);
      console.log(`Total messages after compression: ${compressedMessages.length}`);
      console.log(`Total messages after limiting: ${limitedMessages.length}`);
      console.log(`Messages dropped by compression: ${llmMessages.length - compressedMessages.length}`);
      console.log(`Messages dropped by token limit: ${compressedMessages.length - limitedMessages.length}`);
      console.log(`Total messages dropped: ${llmMessages.length - limitedMessages.length}`);
      console.log('');
      console.log('Compression stats:');
      console.log(`  Compression ratio: ${(compressionResult.stats.compressionRatio * 100).toFixed(1)}%`);
      console.log(`  Char savings: ${compressionResult.stats.originalTotalLength - compressionResult.stats.compressedTotalLength} chars`);
      console.log('');

      console.log('========================================');
      console.log('TOKEN-LIMITED MESSAGES (SENT TO LLM):');
      console.log('========================================');
      limitedMessages.forEach((msg, index) => {
        formatLLMMessage(msg, index);
      });

      console.log('\n--- Summary ---');
      const roleCounts = limitedMessages.reduce((acc, msg) => {
        acc[msg.role] = (acc[msg.role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('Messages by role:');
      Object.entries(roleCounts).forEach(([role, count]) => {
        console.log(`  ${role}: ${count}`);
      });

      const toolMessages = limitedMessages.filter(msg => msg.role === 'tool').length;
      const assistantWithTools = limitedMessages.filter(msg => msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0).length;

      console.log(`\nTool messages: ${toolMessages}`);
      console.log(`Assistant messages with tool calls: ${assistantWithTools}`);
    }

    console.log('\n========================================');
    console.log('Debug complete!');
    console.log('========================================');

  } catch (error) {
    console.error('\n========================================');
    console.error('ERROR');
    console.error('========================================');
    console.error(error);
    process.exit(1);
  }
}

main();
