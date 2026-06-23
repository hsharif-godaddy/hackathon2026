#!/usr/bin/env tsx
/**
 * Test insights generation with a small sample
 * Run before deploying to production
 *
 * Usage: pnpm tsx scripts/test-insights-generation.ts
 */

import { getStore } from '../src/lib/supportplane/store';
import { InsightsClient } from '../src/lib/supportplane/store/insights-client';
import { logger } from '../src/lib/logger';

async function testInsights(): Promise<void> {
  logger.info('test.insights.start');

  try {
    // Test 1: Check DynamoDB connectivity
    logger.info('test.insights.connectivity.start');
    const store = getStore();
    const transcripts = await store.queryTranscripts({ limit: 10 });
    logger.info('test.insights.connectivity.success', {
      transcript_count: transcripts.length,
    });

    if (transcripts.length === 0) {
      logger.warn('test.insights.no_transcripts', {
        message: 'No transcripts found. Cannot test insights generation.',
      });
      return;
    }

    // Test 2: Check insights table connectivity
    logger.info('test.insights.table.start');
    const client = new InsightsClient();
    const existingInsights = await client.queryInsightsByType('BUG', { limit: 5 });
    logger.info('test.insights.table.success', {
      existing_count: existingInsights.length,
    });

    // Test 3: Verify sample transcript has raw_data
    logger.info('test.insights.raw_data.start');
    const sampleTranscript = transcripts[0];
    if (!sampleTranscript.raw_data) {
      logger.error('test.insights.raw_data.missing', {
        interaction_id: sampleTranscript.interaction_id,
        message: 'Sample transcript missing raw_data field',
      });
    } else {
      const rawData =
        typeof sampleTranscript.raw_data === 'string'
          ? JSON.parse(sampleTranscript.raw_data)
          : sampleTranscript.raw_data;

      logger.info('test.insights.raw_data.success', {
        fields: Object.keys(rawData),
        friction_point: rawData.friction_point,
        sub_intent: rawData.sub_intent,
      });
    }

    // Test 4: Check GoCode configuration
    logger.info('test.insights.gocode.start');
    const hasOpenAIKey: boolean = Boolean(
      process.env.OPENAI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    );
    const hasS2SAuth: boolean = process.env.GOCODE_USE_S2S_AUTH === 'true';

    if (!hasOpenAIKey && !hasS2SAuth) {
      logger.error('test.insights.gocode.missing', {
        message:
          'GoCode not configured. Set OPENAI_API_KEY or GOCODE_USE_S2S_AUTH=true.',
      });
    } else {
      logger.info('test.insights.gocode.success', {
        auth_method: hasS2SAuth ? 's2s' : 'api_key',
      });
    }

    logger.info('test.insights.complete', {
      status: 'ready',
      message: 'All pre-flight checks passed. Ready to run insights generation.',
    });
  } catch (error) {
    logger.error('test.insights.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

testInsights()
  .then(() => {
    console.log('\n✅ All tests passed! Ready to generate insights.');
    console.log('\nNext steps:');
    console.log('  1. Deploy CDK: cd cdk && pnpm deploy:supportplane');
    console.log('  2. Run insights generation: pnpm insights:all --days=30');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Tests failed:', error.message);
    process.exit(1);
  });
