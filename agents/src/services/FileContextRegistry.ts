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
   */
  recordFileModification(appPath: string, filePath: string, success: boolean): void {
    if (this.contextManager) {
      this.contextManager.recordFileModification(appPath, filePath, success);
    }
  }

  /**
   * Record a file read operation
   */
  recordFileRead(appPath: string, filePath: string): void {
    if (this.contextManager) {
      this.contextManager.recordFileRead(appPath, filePath);
    }
  }

  /**
   * Get file context summary for an app
   */
  getFileContextSummary(appPath: string): {
    totalFiles: number;
    hotFiles: number;
    totalTokensUsed: number;
  } | null {
    if (this.contextManager) {
      return this.contextManager.getFileContextSummary(appPath);
    }
    return null;
  }
}

// Export singleton instance
export const fileContextRegistry = new FileContextRegistry();