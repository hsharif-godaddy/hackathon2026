#!/usr/bin/env tsx
/**
 * Debug utility for message building pipeline
 * 
 * Usage: pnpm debug:messages <appId> <agentId>
 * 
 * Shows the complete message flow through:
 * 1. Database loading (all conversations for app/agent)
 * 2. LLM conversion
 * 3. Compression
 * 4. Token limiting
 * 5. Final messageProvider output
 */

import { ConversationRepository } from '../src/database/repositories/ConversationRepository.js';
import { ConversationContextManager } from '../src/services/ConversationContextManager.js';
import { AppRepository } from '../src/database/repositories/AppRepository.js';

const appId = process.argv[2];
const agentId = process.argv[3];

if (!appId || !agentId) {
  console.error('Usage: pnpm debug:messages <appId> <agentId>');
  console.error('');
  console.error('Arguments:');
  console.error('  appId   - Required. App ID');
  console.error('  agentId - Required. Agent ID (e.g., "develop")');
  console.error('');
  console.error('Examples:');
  console.error('  pnpm debug:messages fb11112b-0747-482b-93e5-a3ec1dd574a1 develop');
  process.exit(1);
}

/**
 * Format a message for display
 */
function formatMessage(msg: any, index: number): string {
  const lines: string[] = [];
  lines.push(`\n[${index + 1}] ${msg.role.toUpperCase()}`);
  
  // Content
  if (msg.content) {
    const contentStr = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    const preview = contentStr.substring(0, 100).replace(/\n/g, ' ');
    lines.push(`    Content: ${preview}${contentStr.length > 100 ? '...' : ''} (${contentStr.length} chars)`);
  }
  
  // Tool calls
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    lines.push(`    Tool Calls: ${msg.tool_calls.length}`);
    msg.tool_calls.forEach((tc: any, i: number) => {
      const args = typeof tc.function.arguments === 'string' 
        ? JSON.parse(tc.function.arguments) 
        : tc.function.arguments;
      const argKeys = Object.keys(args);
      lines.push(`      [${i + 1}] ${tc.function.name}(${argKeys.join(', ')})`);
    });
  }
  
  // Tool result reference
  if (msg.tool_call_id) {
    lines.push(`    Tool Result: ${msg.name} (ID: ${msg.tool_call_id.substring(0, 8)}...)`);
  }
  
  return lines.join('\n');
}

/**
 * Main execution
 */
async function main() {
  console.log('=== Message Building Pipeline Debug ===');
  console.log(`App ID: ${appId}`);
  console.log(`Agent ID: ${agentId}`);
  console.log('');

  try {
    const conversationRepo = new ConversationRepository();
    const contextManager = new ConversationContextManager(conversationRepo);
    const appRepo = new AppRepository();
    
    // Get app path
    const app = appRepo.findById(appId);
    const appPath = app?.path;
    
    console.log(`App Path: ${appPath || 'NOT FOUND'}`);
    console.log('');

    // Step 1: Load from messageProvider (simulates what WebSocket does)
    console.log('========================================');
    console.log('STEP 1: MESSAGE PROVIDER OUTPUT');
    console.log('========================================');
    console.log('This is what the WebSocket server gets from messageProvider.loadMessages()');
    console.log('');

    const modelName = 'claude-sonnet-4-6';
    const historyLoader = contextManager.getHistoryLoader();
    
    const llmMessages = await historyLoader.loadMessagesWithTokenLimit(
      appId,
      agentId,
      40000,
      modelName,
      true,
      appPath
    );
    
    const messages = historyLoader.formatMessagesForAISDK(llmMessages, appId, agentId);

    console.log(`Total messages: ${messages.length}`);
    console.log('');

    // Count message types
    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;
    const toolMessages = messages.filter(m => m.role === 'tool').length;
    const assistantWithTools = messages.filter(m => m.role === 'assistant' && m.tool_calls).length;
    const totalToolCalls = messages
      .filter(m => m.role === 'assistant' && m.tool_calls)
      .reduce((sum, m) => sum + (m.tool_calls?.length || 0), 0);

    console.log('Summary:');
    console.log(`  User messages: ${userMessages}`);
    console.log(`  Assistant messages: ${assistantMessages}`);
    console.log(`  - With tool calls: ${assistantWithTools} (${totalToolCalls} total calls)`);
    console.log(`  - Without tool calls: ${assistantMessages - assistantWithTools}`);
    console.log(`  Tool result messages: ${toolMessages}`);
    console.log('');

    // Step 2: Simulate filtering (what messageProvider does)
    console.log('========================================');
    console.log('STEP 2: AFTER FILTERING (messageProvider)');
    console.log('========================================');
    console.log('Tool messages are filtered out (role="tool" not supported by AI SDK)');
    console.log('');

    const filteredMessages = messages.filter(msg => msg.role !== 'tool');
    
    console.log(`Filtered messages: ${filteredMessages.length}`);
    console.log(`Removed: ${messages.length - filteredMessages.length} tool messages`);
    console.log('');

    // Step 3: Show detailed message list
    console.log('========================================');
    console.log('DETAILED MESSAGE LIST');
    console.log('========================================');

    filteredMessages.forEach((msg, index) => {
      console.log(formatMessage(msg, index));
    });

    // Step 4: Check for issues
    console.log('\n========================================');
    console.log('ISSUE DETECTION');
    console.log('========================================');

    const issues: string[] = [];

    // Check for array content
    const arrayContentMsgs = filteredMessages.filter(m => Array.isArray(m.content));
    if (arrayContentMsgs.length > 0) {
      issues.push(`⚠️  ${arrayContentMsgs.length} messages have array content (should be string)`);
    }

    // Check for assistant messages without tool_calls
    const assistantNoTools = filteredMessages.filter(m => 
      m.role === 'assistant' && (!m.tool_calls || m.tool_calls.length === 0)
    );
    if (assistantNoTools.length > 0) {
      issues.push(`ℹ️  ${assistantNoTools.length} assistant messages without tool calls`);
    }

    // Check for empty content
    const emptyContent = filteredMessages.filter(m => !m.content || m.content.length === 0);
    if (emptyContent.length > 0) {
      issues.push(`⚠️  ${emptyContent.length} messages with empty content`);
    }

    if (issues.length === 0) {
      console.log('✅ No issues detected!');
    } else {
      console.log('Issues found:');
      issues.forEach(issue => console.log(`  ${issue}`));
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
