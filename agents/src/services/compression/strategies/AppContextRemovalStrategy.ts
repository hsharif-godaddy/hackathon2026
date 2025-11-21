import type { CompressionStrategy, CompressionContext } from '../MessageCompressor.js';
import type { LLMMessage } from '../../ConversationHistoryLoader.js';

/**
 * Removes ALL app context messages from conversation history
 *
 * App context (directory structure, secrets, etc.) is regenerated fresh on every
 * turn and injected via insertionOrder: 'before_history'. Historical app context
 * messages contain stale information and should be removed to prevent conflicts.
 *
 * This strategy removes:
 * - User messages containing app directory structure
 * - User messages containing secrets list
 * - Any other app context messages from previous turns
 */
export class AppContextRemovalStrategy implements CompressionStrategy {
  readonly name = 'app-context-removal';

  /**
   * Check if this message is an app context message from a previous turn
   */
  canCompress(context: CompressionContext): boolean {
    const { message } = context;

    // Only check user messages (app context is injected as user messages)
    if (message.role !== 'user') {
      return false;
    }

    const content = message.content;
    if (typeof content !== 'string') {
      return false;
    }

    // Detect app context messages by their distinctive markers
    // These patterns match the AppContextManager formatting, specifically the secrets list section
    const appContextPatterns = [
      /^🔐 LIVE SECRETS STATE - REFRESHED ON THIS MESSAGE/m, // Secrets list
      /^ONLY use secrets that appear in THIS list - ignore any from conversation history/m,   // Secrets list instructions
      /^📝 How to use these secrets in backend code/m,   // Secrets list instructions
      /^NO SECRETS CURRENTLY CONFIGURED/m,                        // Empty secrets state
      /^CURRENTLY CONFIGURED SECRETS:/m,          // Secrets list confirmation
      /^[Current Project Context]/m,               // Project context header
      /^Directory Structure:/m,                   // Directory structure header
    ];

    // If any pattern matches, this is an app context message
    return appContextPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Remove the message completely by returning null
   */
  compress(context: CompressionContext): LLMMessage | null {
    // Returning null removes the message from history
    return null;
  }
}
