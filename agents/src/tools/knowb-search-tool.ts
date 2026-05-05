/**
 * KnowB Search Tool
 *
 * Searches GoDaddy's knowledge base via GoKnowb + Cohere reranking.
 * Post-processing (dedup + top-K=3) is handled inside KnowBDriver.
 */
import { Logger, log } from '../logging/index.js';
import {
  knowBDriver,
  type KnowBSearchOptions as DriverSearchOptions,
} from './ai-lib-tools/drivers/knowb-driver.js';

const logger = Logger.create({ component: 'knowb-search-tool' });

/**
 * Options for KnowB search (extends driver options with appId)
 */
export interface KnowBSearchOptions extends DriverSearchOptions {
  appId?: string;
}

/**
 * KnowB search result
 */
export interface KnowBSearchResult {
  success: boolean;
  results?: KnowBSearchItem[];
  totalResults?: number;
  error?: string;
}

/**
 * Individual KnowB search result item
 */
export interface KnowBSearchItem {
  location: {
    kbNodeId: string;
  };
  content: {
    text: string;
    type: string;
  };
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * KnowB Search Tool
 * Wrapper around KnowBDriver that adds app context logging
 */
export class KnowBSearchTool {
  /**
   * Search the knowledge base
   *
   * @param options - Search options
   * @returns Promise resolving to search results
   */
  async search(options: KnowBSearchOptions): Promise<KnowBSearchResult> {
    const contextLogger = options.appId
      ? log.withContext({ appId: options.appId })
      : logger;

    contextLogger.info('knowb-search.search.start', {
      query: options.query,
      kbNodeIds: options.kbNodeIds,
      maxResults: options.maxResults,
      scoreThreshold: options.scoreThreshold,
    });

    const driverResult = await knowBDriver.search({
      query: options.query,
      kbNodeIds: options.kbNodeIds,
      maxResults: options.maxResults,
      scoreThreshold: options.scoreThreshold,
    });

    if (!driverResult.success) {
      // warn (not error) to match the driver + context-builders severity for
      // the same failure modes (auth not configured, empty query, upstream
      // error). Reserve error for true pager-worthy conditions.
      contextLogger.warn('knowb-search.search.failed', {
        error: driverResult.error,
        query: options.query.substring(0, 100),
      });
      return {
        success: false,
        error: driverResult.error,
      };
    }

    // Transform driver results to tool format (with full content structure)
    const results: KnowBSearchItem[] = (driverResult.results || []).map((item) => ({
      location: {
        kbNodeId: item.kbNodeId,
      },
      content: {
        text: item.text,
        type: 'text',
      },
      score: item.score,
    }));

    contextLogger.info('knowb-search.search.success', {
      query: options.query,
      totalResults: results.length,
      scores: results.map((r) => r.score),
    });

    return {
      success: true,
      results,
      totalResults: results.length,
    };
  }
}

/**
 * Singleton instance
 */
export const knowBSearchTool = new KnowBSearchTool();

/**
 * Helper function for quick searches
 *
 * @param query - Search query
 * @param options - Additional search options
 * @returns Promise resolving to search results
 */
export async function searchKnowB(
  query: string,
  options?: Omit<KnowBSearchOptions, 'query'>
): Promise<KnowBSearchResult> {
  return knowBSearchTool.search({ query, ...options });
}
