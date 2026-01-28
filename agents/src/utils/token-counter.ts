/**
 * Token counting utility - re-exports from @airo/ai-lib
 *
 * This module re-exports the consolidated token counting utilities from ai-lib.
 * All token counting should use these functions to ensure consistency across the codebase.
 */

export {
  countTokens,
  countTotalTokens,
  countConversationTokens,
  isTokenCountingSupported,
  getModelProvider,
  type TokenCountResult,
  type ModelProvider,
  type SupportedModel
} from '@airo/ai-lib'
