import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

/**
 * Annotates user messages about secret operations to prevent LLM from inferring stale secret state
 *
 * When users add/update secrets via the chat UI, success messages like:
 *   "Secrets added successfully: MY_SECRET. Please continue."
 * are saved to conversation history.
 *
 * If the secret is later deleted via Settings panel, the LLM might still see
 * these historical messages and incorrectly assume the secrets exist.
 *
 * This strategy annotates such messages with a note to always check the fresh
 * context for current secret state.
 */
export class SecretOperationCompressionStrategy implements CompressionStrategy {
  readonly name = 'secret-operation-compression';
  readonly strategyType = 'removal' as const;

  /**
   * Check if this message is about secret operations
   */
  canCompress(context: CompressionContext): boolean {
    const { message } = context;

    // Only check user messages
    if (message.role !== 'user') {
      return false;
    }

    const content = message.content;
    if (typeof content !== 'string') {
      return false;
    }

    // Detect secret operation messages
    const secretOperationPatterns = [
      /Secrets?\s+(added|updated|saved)\s+successfully/i,
      /I\s+cancelled\s+adding\s+secrets/i,
      /Secret\s+value\s+is\s+required/i,
    ];

    return secretOperationPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Remove the message completely to prevent LLM from using stale secret info
   *
   * We remove rather than annotate because:
   * 1. The fresh context already has current secret state
   * 2. Annotation still leaves the stale info visible to the LLM
   * 3. The user's confirmation message is ephemeral and shouldn't persist
   */
  compress(context: CompressionContext): LLMMessage | null {
    // Return null to remove the message entirely
    return null;
  }
}
