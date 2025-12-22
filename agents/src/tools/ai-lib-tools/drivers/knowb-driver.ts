/**
 * KnowB Knowledge Base Driver
 *
 * Handles knowledge base search through the proxy or direct API
 * - Proxy mode: Uses PROXY_URL with GETTY_TOKEN for authentication
 * - Direct mode: Uses SSO_JWT for local development
 */
import { log } from '../../../logging/index.js';

import { BaseDriver } from './base-driver.js';

/**
 * Options for KnowB search
 */
export interface KnowBSearchOptions {
  query: string;
  kbNodeIds?: string[];
  maxResults?: number;
  scoreThreshold?: number;
}

/**
 * Individual search result item
 */
export interface KnowBResultItem {
  kbNodeId: string;
  text: string;
  score: number;
}

/**
 * KnowB search result
 */
export interface KnowBSearchResult {
  success: boolean;
  results?: KnowBResultItem[];
  totalResults?: number;
  error?: string;
}

/**
 * API response structure from KnowB
 */
interface KnowBAPIResponse {
  results: Array<{
    location: {
      kbNodeId: string;
    };
    metadata: Record<string, unknown>;
    content: {
      text: string;
      type: string;
    };
    score: number;
  }>;
}

/**
 * KnowB Knowledge Base Driver
 * Handles semantic search against GoDaddy's knowledge base
 */
export class KnowBDriver extends BaseDriver {
  private directApiUrl: string;

  constructor() {
    super({
      serviceName: 'knowb-driver',
      defaultBaseUrl: '',
    });

    this.directApiUrl = process.env.KNOWB_API_URL || 'https://knowb.api.int.test-godaddy.com/v1/search';

    this.logger.info('knowb-driver.direct-api.configured', {
      directApiUrl: this.directApiUrl,
      useProxy: this.useProxy,
    });

    if (!this.hasAuth()) {
      this.logger.warn('knowb-driver.auth.missing', {
        message: 'No auth configured. Set GETTY_API_URL + GETTY_TOKEN for hosted or SSO_JWT for local.',
      });
    }
  }

  /**
   * Search the knowledge base
   *
   * @param options - Search options containing query and filters
   * @returns Promise resolving to search results
   */
  async search(options: KnowBSearchOptions): Promise<KnowBSearchResult> {
    const {
      query,
      kbNodeIds = ['/airo_sys'],
      maxResults = 5,
      scoreThreshold = 0.35,
    } = options;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        success: false,
        error: 'A valid search query is required',
      };
    }

    this.logger.info('knowb-driver.search.begin', {
      query: query.substring(0, 100),
      kbNodeIds,
      maxResults,
      scoreThreshold,
      useProxy: this.useProxy,
    });

    try {
      if (this.useProxy) {
        return await this.searchViaProxy(query, kbNodeIds, maxResults, scoreThreshold);
      } else {
        return await this.searchDirect(query, kbNodeIds, maxResults, scoreThreshold);
      }
    } catch (error) {
      log.error(this.logger, 'knowb-driver.search.error', error as Error, {
        query: query.substring(0, 100),
      });

      return {
        success: false,
        error: `Knowledge base search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Search via proxy (hosted mode)
   */
  private async searchViaProxy(
    query: string,
    kbNodeIds: string[],
    maxResults: number,
    scoreThreshold: number
  ): Promise<KnowBSearchResult> {
    const response = await this.post('/v1/knowb/search', {
      query: query.trim(),
      kbNodeIds,
      maxResults,
      scoreThreshold,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error('knowb-driver.proxy.error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `KnowB proxy error: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as KnowBAPIResponse;
    return this.parseResponse(data, query);
  }

  /**
   * Search directly (local mode with SSO_JWT)
   */
  private async searchDirect(
    query: string,
    kbNodeIds: string[],
    maxResults: number,
    scoreThreshold: number
  ): Promise<KnowBSearchResult> {
    if (!this.hasAuth()) {
      return {
        success: false,
        error: this.getAuthErrorMessage(),
      };
    }

    const requestBody = {
      filter: {
        kbNodeIds,
        maxNumberOfResult: maxResults,
        scoreThreshold,
      },
      query: query.trim(),
      searchType: 'auto',
    };

    const response = await fetch(this.directApiUrl, {
      method: 'POST',
      headers: this.getHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error('knowb-driver.api.error', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `KnowB API error: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as KnowBAPIResponse;
    return this.parseResponse(data, query);
  }

  /**
   * Parse API response into driver result format
   */
  private parseResponse(data: KnowBAPIResponse, query: string): KnowBSearchResult {
    const results: KnowBResultItem[] = data.results.map((item) => ({
      kbNodeId: item.location.kbNodeId,
      text: item.content.text,
      score: item.score,
    }));

    this.logger.info('knowb-driver.search.success', {
      query: query.substring(0, 100),
      totalResults: results.length,
      topScore: results[0]?.score.toFixed(3),
    });

    return {
      success: true,
      results,
      totalResults: results.length,
    };
  }

  /**
   * Format results as markdown for context injection
   */
  formatResultsAsMarkdown(results: KnowBResultItem[]): string {
    if (!results || results.length === 0) {
      return '';
    }

    return results
      .map((item, index) => {
        return `## Document ${index + 1}: ${item.kbNodeId}\n**Relevance Score:** ${item.score.toFixed(3)}\n\n${item.text}\n`;
      })
      .join('\n---\n\n');
  }
}

/**
 * Singleton instance for convenience
 */
export const knowBDriver = new KnowBDriver();
