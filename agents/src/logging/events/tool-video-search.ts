import type { Logger } from '../index.js';

/**
 * Metadata for video search tool events
 */
export interface VideoSearchEventMetadata {
  toolName: string;
  prompt: string;
  provider: string;
  resultUrl?: string;
}

/**
 * Video search tool events
 */
export const toolVideoSearchEvents = {
  /**
   * Video search operation started
   */
  begin(logger: Logger, metadata: VideoSearchEventMetadata): void {
    logger.info('tool.video-search.begin', {
      toolName: metadata.toolName,
      prompt: metadata.prompt,
      provider: metadata.provider,
    });
  },

  /**
   * Video search operation succeeded
   */
  success(logger: Logger, metadata: VideoSearchEventMetadata): void {
    logger.info('tool.video-search.success', {
      toolName: metadata.toolName,
      prompt: metadata.prompt,
      provider: metadata.provider,
      resultUrl: metadata.resultUrl,
    });
  },

  /**
   * Video search operation failed
   */
  failure(logger: Logger, error: Error, metadata: VideoSearchEventMetadata): void {
    logger.error('tool.video-search.failure', {
      toolName: metadata.toolName,
      prompt: metadata.prompt,
      provider: metadata.provider,
      error: error.message,
      stack: error.stack,
    });
  }
};

