import { conversationRepository } from '../../database/repositories/index.js';
import { SummaryRepository } from '../../database/repositories/SummaryRepository.js';
import { BackgroundSummarizer } from './BackgroundSummarizer.js';
import { LLMSummarizationStrategy } from './LLMSummarizationStrategy.js';
import { DetailedLLMSummarizationStrategy } from './DetailedLLMSummarizationStrategy.js';
import type { SummarizationStrategy } from './SummarizationStrategy.js';
import { logger } from '../../logging/index.js';

let backgroundSummarizer: BackgroundSummarizer | null = null;
let isInitialized = false;

/**
 * Summarization strategy type
 */
export type SummarizationStrategyType = 'llm' | 'detailed-llm' | 'simple';

/**
 * Initialize background summarization system
 * This should be called once at application startup
 * @param config - Optional configuration for the background summarizer
 * @returns The initialized BackgroundSummarizer instance
 */
export async function initializeBackgroundSummarization(config?: {
  tokenThreshold?: number;
  debounceMs?: number;
  keepRecentTurns?: number;
  strategy?: SummarizationStrategyType;
}): Promise<BackgroundSummarizer> {
  if (isInitialized && backgroundSummarizer) {
    logger.debug('summarization.initialize.already_initialized', {
      message: 'Background summarization already initialized, returning existing instance',
    });
    return backgroundSummarizer;
  }

  const strategyType = config?.strategy || 'llm';
  
  logger.info('summarization.initialize.begin', {
    tokenThreshold: config?.tokenThreshold || 10000,
    debounceMs: config?.debounceMs || 5000,
    keepRecentTurns: config?.keepRecentTurns || 3,
    strategy: strategyType,
  });

  const summaryRepo = new SummaryRepository();
  
  // Select summarization strategy
  let summarizationStrategy: SummarizationStrategy;
  switch (strategyType) {
    case 'detailed-llm': {
      summarizationStrategy = new DetailedLLMSummarizationStrategy();
      break;
    }
    case 'simple': {
      // Import SimpleSummarizationStrategy dynamically to avoid circular deps
      const { SimpleSummarizationStrategy } = await import('./SimpleSummarizationStrategy.js');
      summarizationStrategy = new SimpleSummarizationStrategy();
      break;
    }
    case 'llm':
    default: {
      summarizationStrategy = new LLMSummarizationStrategy();
      break;
    }
  }

  backgroundSummarizer = new BackgroundSummarizer(
    conversationRepository,
    summaryRepo,
    summarizationStrategy,
    {
      tokenThreshold: config?.tokenThreshold || 10000,
      debounceMs: config?.debounceMs || 5000,
      keepRecentTurns: config?.keepRecentTurns || 3,
    }
  );

  // Register hook on the singleton conversation repository
  conversationRepository.registerMessageAddedHook(async (message, conversationId) => {
    try {
      const conversation = await conversationRepository.getById(conversationId);
      if (conversation) {
        logger.debug('summarization.hook.triggered', {
          conversationId,
          appId: conversation.appId,
          messageId: message.id,
        });
        await backgroundSummarizer?.checkAndSummarize(conversation.appId);
      }
    } catch (error) {
      logger.error('summarization.hook.failure', {
        conversationId,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  isInitialized = true;

  logger.info('summarization.initialize.complete', {
    message: 'Background summarization initialized and hook registered',
  });

  return backgroundSummarizer;
}

/**
 * Get the background summarizer instance
 * @returns The BackgroundSummarizer instance, or null if not initialized
 */
export function getBackgroundSummarizer(): BackgroundSummarizer | null {
  return backgroundSummarizer;
}

/**
 * Check if background summarization is initialized
 * @returns True if initialized, false otherwise
 */
export function isBackgroundSummarizationInitialized(): boolean {
  return isInitialized;
}

