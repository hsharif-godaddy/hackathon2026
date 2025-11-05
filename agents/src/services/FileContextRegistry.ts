import type { AILibContextManager } from '../agents/ai-lib-agents/context-manager.js';

/**
 * Global registry for file context management
 * Allows tools to record file operations for hot file tracking
 */
class FileContextRegistry {
  private contextManager: AILibContextManager | null = null;

  /**
   * Set the context manager instance
   */
  setContextManager(manager: AILibContextManager): void {
    this.contextManager = manager;
  }

  /**
   * Record a file modification operation
   * NOTE: This is now a no-op. Hot files are tracked automatically from conversation history
   * via the HotFileInclusionStrategy compression strategy.
   */
  recordFileModification(appPath: string, filePath: string, success: boolean): void {
    // No-op: Hot files now derived from tool call history
  }

  /**
   * Record a file read operation
   * NOTE: This is now a no-op. Hot files are tracked automatically from conversation history
   * via the HotFileInclusionStrategy compression strategy.
   */
  recordFileRead(appPath: string, filePath: string): void {
    // No-op: Hot files now derived from tool call history
  }

  /**
   * Get file context summary for an app
   * NOTE: This method is deprecated. Hot files are managed by the history loader.
   */
  getFileContextSummary(appPath: string): {
    totalFiles: number;
    hotFiles: number;
    totalTokensUsed: number;
  } | null {
    return null;
  }
}

// Export singleton instance
export const fileContextRegistry = new FileContextRegistry();