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

  const strategyType = config?.strategy || 'detailed-llm';

  // Build config object only with explicitly provided values
  // This allows BackgroundSummarizer's tuned defaults (35k tokens, 30s debounce, 4 turns) to apply
  const summarizerConfig: Partial<{
    tokenThreshold: number;
    debounceMs: number;
    keepRecentTurns: number;
  }> = {};
  if (config?.tokenThreshold !== undefined) summarizerConfig.tokenThreshold = config.tokenThreshold;
  if (config?.debounceMs !== undefined) summarizerConfig.debounceMs = config.debounceMs;
  if (config?.keepRecentTurns !== undefined) summarizerConfig.keepRecentTurns = config.keepRecentTurns;

  logger.info('summarization.initialize.begin', {
    tokenThreshold: config?.tokenThreshold ?? 35000,
    debounceMs: config?.debounceMs ?? 30000,
    keepRecentTurns: config?.keepRecentTurns ?? 4,
    strategy: strategyType,
    usingDefaults: Object.keys(summarizerConfig).length === 0,
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
    summarizerConfig
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

        // Trigger summarization check
        await backgroundSummarizer?.checkAndSummarize(conversation.appId);

        // Note: Skill auto-unload is now handled by step-based tracking in prepareStep hook
        // See agent-factory.ts prepareStep and SkillToolManager.cleanupInactiveSkills
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

