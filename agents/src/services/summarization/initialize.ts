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
  maxPromptTokens?: number;
  debounceMs?: number;
  keepRecentTurns?: number;
  disableFullRegeneration?: boolean;
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
  // This allows BackgroundSummarizer's defaults (10k max prompt, 3s debounce, 4 turns) to apply
  const summarizerConfig: Partial<{
    maxPromptTokens: number;
    debounceMs: number;
    keepRecentTurns: number;
    disableFullRegeneration: boolean;
  }> = {};
  if (config?.maxPromptTokens !== undefined) summarizerConfig.maxPromptTokens = config.maxPromptTokens;
  if (config?.debounceMs !== undefined) summarizerConfig.debounceMs = config.debounceMs;
  if (config?.keepRecentTurns !== undefined) summarizerConfig.keepRecentTurns = config.keepRecentTurns;
  if (config?.disableFullRegeneration !== undefined) summarizerConfig.disableFullRegeneration = config.disableFullRegeneration;

  logger.info('summarization.initialize.begin', {
    maxPromptTokens: config?.maxPromptTokens ?? 10000,
    debounceMs: config?.debounceMs ?? 3000,
    keepRecentTurns: config?.keepRecentTurns ?? 4,
    disableFullRegeneration: config?.disableFullRegeneration ?? true,
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

  isInitialized = true;

  logger.info('summarization.initialize.complete', {
    message: 'Background summarization initialized',
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
