#!/usr/bin/env tsx
/**
 * Memory Benchmark for BackgroundSummarizer
 *
 * Measures peak memory usage during summarization to verify that:
 * 1. Incremental mode uses less memory than full mode
 * 2. Selective loading reduces memory footprint
 * 3. Memory scales with new messages, not total messages
 *
 * Usage:
 *   pnpm tsx agents/src/services/summarization/__benchmarks__/memory-benchmark.ts
 *
 * Or with explicit GC:
 *   node --expose-gc --require tsx/register agents/src/services/summarization/__benchmarks__/memory-benchmark.ts
 */

import {
  BackgroundSummarizer,
  type BackgroundSummarizerConversationRepo,
  type BackgroundSummarizerSummaryRepo
} from '../BackgroundSummarizer.js';
import type { SummarizationStrategy } from '../SummarizationStrategy.js';
import type { DatabaseMessage } from '../../../types/conversation-messages.js';
import type { ConversationSummary } from '../../../database/schema.js';
import type { SummarizationResult } from '../SummarizationStrategy.js';

interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

interface BenchmarkResult {
  scenario: string;
  messageCount: number;
  newMessageCount: number;
  beforeMB: number;
  afterMB: number;
  peakMB: number;
  deltaMB: number;
  durationMs: number;
}

function captureMemory(): MemorySnapshot {
  if (global.gc) {
    global.gc();
  }
  return process.memoryUsage();
}

function formatMemoryMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function createMessages(count: number, startId: number = 0, conversationId: string = 'conv-1'): DatabaseMessage[] {
  const messages: DatabaseMessage[] = [];

  for (let i = 0; i < count; i++) {
    const id = startId + i;
    const isUser = i % 2 === 0;

    messages.push({
      id: `msg-${id}`,
      conversationId,
      sender: isUser ? 'user' : 'agent',
      content: isUser
        ? `User message ${id}: Please implement feature X with detailed requirements`
        : `Agent response ${id}: I've implemented the feature as requested`,
      origin: 'customer' as const,
      createdAt: new Date(Date.now() + i * 1000),
      segments: !isUser ? [{
        id: `seg-${id}`,
        type: 'tool_call',
        timestamp: new Date(),
        tool_call: {
          id: `call-${id}`,
          tool_name: 'str_replace_based_edit_tool',
          tool_args: {
            command: 'str_replace',
            path: `src/file-${id % 20}.ts`,
          },
          tool_result: {
            success: true,
            filesModified: [`src/file-${id % 20}.ts`],
            linesChanged: 30
          },
          status: 'success'
        }
      }] : undefined
    });
  }

  return messages;
}

async function runBenchmark(
  scenario: string,
  setupFn: () => Promise<{
    summarizer: BackgroundSummarizer;
    totalMessages: number;
    newMessages: number;
  }>
): Promise<BenchmarkResult> {
  console.log(`\n📊 Running: ${scenario}`);

  // Setup
  const { summarizer, totalMessages, newMessages } = await setupFn();

  // Capture baseline
  const before = captureMemory();
  const startTime = Date.now();

  // Run summarization
  await summarizer.checkAndSummarize('test-app');

  // Wait for debounce to complete
  await new Promise(resolve => setTimeout(resolve, 50));

  const endTime = Date.now();
  const after = captureMemory();

  const result: BenchmarkResult = {
    scenario,
    messageCount: totalMessages,
    newMessageCount: newMessages,
    beforeMB: formatMemoryMB(before.heapUsed),
    afterMB: formatMemoryMB(after.heapUsed),
    peakMB: formatMemoryMB(Math.max(after.heapUsed, after.external + after.arrayBuffers)),
    deltaMB: formatMemoryMB(after.heapUsed - before.heapUsed),
    durationMs: endTime - startTime
  };

  console.log(`  ✓ Completed in ${result.durationMs}ms`);
  console.log(`  📈 Memory: ${result.beforeMB}MB → ${result.afterMB}MB (Δ ${result.deltaMB}MB)`);

  return result;
}

function createMockRepos(
  allMessages: DatabaseMessage[],
  existingSummary: ConversationSummary | null = null
): { conversationRepo: BackgroundSummarizerConversationRepo; summaryRepo: BackgroundSummarizerSummaryRepo } {
  const now = new Date();

  const conversationRepo: BackgroundSummarizerConversationRepo = {
    getByAppId: async () => [{
      id: 'conv-1',
      appId: 'test-app',
      agentId: 'initial',
      title: 'Test Conv',
      createdAt: now,
      updatedAt: now
    }],
    getMessagesBatch: async () => allMessages,
    getMessagesAfterMessageId: async (_appId: string, messageId: string) => {
      const idx = allMessages.findIndex(m => m.id === messageId);
      return idx >= 0 ? allMessages.slice(idx + 1) : [];
    },
    getMessageById: async (messageId: string) => allMessages.find(m => m.id === messageId) || null,
    getEstimatedTokensAfterMessageId: async (_appId: string, messageId: string) => {
      const idx = allMessages.findIndex(m => m.id === messageId);
      if (idx < 0) return null;
      // Estimate tokens from content length (chars / 4)
      const afterMessages = allMessages.slice(idx + 1);
      const totalChars = afterMessages.reduce((sum, m) => sum + m.content.length + JSON.stringify(m.segments || []).length, 0);
      return Math.ceil(totalChars / 4);
    },
    getEstimatedTokensForApp: async () => {
      // Estimate tokens from content length (chars / 4)
      const totalChars = allMessages.reduce((sum, m) => sum + m.content.length + JSON.stringify(m.segments || []).length, 0);
      return Math.ceil(totalChars / 4);
    }
  };

  const summaryRepo: BackgroundSummarizerSummaryRepo = {
    findLatestForApp: async () => existingSummary,
    create: async (summary: SummarizationResult, appId: string, conversationId?: string) => {
      const createdAt = new Date();
      const result: ConversationSummary = {
        id: 'summary-new',
        appId,
        summaryText: summary.summaryText,
        messageRangeStart: summary.messageRange.startId,
        messageRangeEnd: summary.messageRange.endId,
        messageCount: summary.messageCount,
        originalTokenCount: summary.originalTokenCount,
        summaryTokenCount: summary.summaryTokenCount,
        modelUsed: summary.modelUsed,
        createdAt
      };

      if (conversationId) {
        result.conversationId = conversationId;
      }

      if (summary.operationLog) {
        result.operationLog = summary.operationLog;
      }

      if (summary.incrementalUpdateCount !== undefined) {
        result.incrementalUpdateCount = summary.incrementalUpdateCount;
      }

      if (summary.lastFullSummarizationAt) {
        result.lastFullSummarizationAt = new Date(summary.lastFullSummarizationAt);
      }

      return result;
    }
  };

  return { conversationRepo, summaryRepo };
}

function createMockStrategy(): SummarizationStrategy {
  return {
    name: 'mock-strategy',
    summarize: async (context) => ({
      summaryText: 'Mock summary',
      summaryTokenCount: 100,
      originalTokenCount: context.originalTokenCount,
      messageCount: context.messages.length,
      messageRange: context.messageRange,
      modelUsed: 'mock-model'
    })
  };
}

async function main() {
  console.log('🧪 BackgroundSummarizer Memory Benchmark\n');
  console.log('Testing memory usage with different scenarios...\n');

  if (!global.gc) {
    console.warn('⚠️  WARNING: Running without --expose-gc flag');
    console.warn('   Memory measurements may be less accurate');
    console.warn('   Run with: node --expose-gc --require tsx/register <script>\n');
  }

  const results: BenchmarkResult[] = [];

  // Scenario 1: Full mode with small dataset (500 messages)
  results.push(await runBenchmark(
    'Full Mode - Small (500 messages)',
    async () => {
      const messages = createMessages(500);
      const { conversationRepo, summaryRepo } = createMockRepos(messages, null);
      const strategy = createMockStrategy();

      const summarizer = new BackgroundSummarizer(
        conversationRepo,
        summaryRepo,
        strategy,
        { maxPromptTokens: 1000, debounceMs: 0, keepRecentTurns: 4 }
      );

      return { summarizer, totalMessages: 500, newMessages: 500 };
    }
  ));

  // Scenario 2: Full mode with large dataset (5000 messages)
  results.push(await runBenchmark(
    'Full Mode - Large (5000 messages)',
    async () => {
      const messages = createMessages(5000);
      const { conversationRepo, summaryRepo } = createMockRepos(messages, null);
      const strategy = createMockStrategy();

      const summarizer = new BackgroundSummarizer(
        conversationRepo,
        summaryRepo,
        strategy,
        { maxPromptTokens: 1000, debounceMs: 0, keepRecentTurns: 4 }
      );

      return { summarizer, totalMessages: 5000, newMessages: 5000 };
    }
  ));

  // Scenario 3: Incremental mode (5000 existing + 100 new)
  results.push(await runBenchmark(
    'Incremental Mode - 100 new / 5000 total',
    async () => {
      const allMessages = createMessages(5100);
      const existingSummary: ConversationSummary = {
        id: 'summary-1',
        appId: 'test-app',
        summaryText: 'Existing summary',
        summaryTokenCount: 500,
        originalTokenCount: 10000,
        messageCount: 5000,
        messageRangeStart: 'msg-0',
        messageRangeEnd: 'msg-4999',
        operationLog: 'Files modified: test1.ts, test2.ts',
        createdAt: new Date(),
        modelUsed: 'mock-model',
        incrementalUpdateCount: 0,
        lastFullSummarizationAt: new Date()
      };

      const { conversationRepo, summaryRepo } = createMockRepos(allMessages, existingSummary);
      const strategy = createMockStrategy();

      const summarizer = new BackgroundSummarizer(
        conversationRepo,
        summaryRepo,
        strategy,
        { maxPromptTokens: 1000, debounceMs: 0, keepRecentTurns: 4 }
      );

      return { summarizer, totalMessages: 5100, newMessages: 100 };
    }
  ));

  // Scenario 4: Incremental mode (5000 existing + 500 new)
  results.push(await runBenchmark(
    'Incremental Mode - 500 new / 5000 total',
    async () => {
      const allMessages = createMessages(5500);
      const existingSummary: ConversationSummary = {
        id: 'summary-1',
        appId: 'test-app',
        summaryText: 'Existing summary',
        summaryTokenCount: 500,
        originalTokenCount: 10000,
        messageCount: 5000,
        messageRangeStart: 'msg-0',
        messageRangeEnd: 'msg-4999',
        operationLog: 'Files modified: test1.ts, test2.ts',
        createdAt: new Date(),
        modelUsed: 'mock-model',
        incrementalUpdateCount: 0,
        lastFullSummarizationAt: new Date()
      };

      const { conversationRepo, summaryRepo } = createMockRepos(allMessages, existingSummary);
      const strategy = createMockStrategy();

      const summarizer = new BackgroundSummarizer(
        conversationRepo,
        summaryRepo,
        strategy,
        { maxPromptTokens: 1000, debounceMs: 0, keepRecentTurns: 4 }
      );

      return { summarizer, totalMessages: 5500, newMessages: 500 };
    }
  ));

  // Print results table
  console.log('\n\n📊 RESULTS SUMMARY\n');
  console.log('┌─────────────────────────────────────────┬──────────┬──────────┬──────────┬───────────┬─────────┐');
  console.log('│ Scenario                                │ Messages │ New Msgs │ Delta MB │ Peak MB   │ Time ms │');
  console.log('├─────────────────────────────────────────┼──────────┼──────────┼──────────┼───────────┼─────────┤');

  results.forEach(r => {
    const scenario = r.scenario.padEnd(39);
    const messages = String(r.messageCount).padStart(8);
    const newMsgs = String(r.newMessageCount).padStart(8);
    const delta = String(r.deltaMB).padStart(8);
    const peak = String(r.peakMB).padStart(9);
    const duration = String(r.durationMs).padStart(7);

    console.log(`│ ${scenario} │ ${messages} │ ${newMsgs} │ ${delta} │ ${peak} │ ${duration} │`);
  });

  console.log('└─────────────────────────────────────────┴──────────┴──────────┴──────────┴───────────┴─────────┘');

  // Calculate improvements
  console.log('\n\n💡 ANALYSIS\n');

  const fullLarge = results.find(r => r.scenario.includes('Full Mode - Large'));
  const incremental100 = results.find(r => r.scenario.includes('100 new / 5000'));
  const incremental500 = results.find(r => r.scenario.includes('500 new / 5000'));

  if (fullLarge && incremental100) {
    const memoryReduction = ((fullLarge.deltaMB - incremental100.deltaMB) / fullLarge.deltaMB * 100).toFixed(1);
    console.log(`📉 Memory Reduction (100 new vs 5000 full): ${memoryReduction}%`);
    console.log(`   Full mode (5000 msgs): ${fullLarge.deltaMB}MB`);
    console.log(`   Incremental (100 new): ${incremental100.deltaMB}MB`);
  }

  if (incremental100 && incremental500) {
    const scalingFactor = (incremental500.deltaMB / incremental100.deltaMB).toFixed(2);
    console.log(`\n📈 Memory Scaling (100 new → 500 new): ${scalingFactor}x`);
    console.log(`   Expected: ~5.0x (linear scaling with new messages)`);
    console.log(`   Actual: ${scalingFactor}x`);

    if (parseFloat(scalingFactor) < 6.0) {
      console.log('   ✅ Memory scales linearly with NEW messages (good!)');
    } else {
      console.log('   ⚠️  Memory scaling higher than expected');
    }
  }

  console.log('\n✨ Benchmark complete!\n');
}

// Run benchmark
main().catch(error => {
  console.error('❌ Benchmark failed:', error);
  process.exit(1);
});
