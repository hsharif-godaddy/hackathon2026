/**
 * KnowB Search Tool
 *
 * Searches GoDaddy's knowledge base API for deployment and application documentation
 *
 * Configuration:
 * - Proxy mode: Set PROXY_URL + GETTY_TOKEN (hosted)
 * - Direct mode: Set SSO_JWT (local development)
 * - KNOWB_API_URL: Optional, defaults to https://knowb.api.int.test-godaddy.com/v1/search
 */
import { Logger, log, ILogger } from '../logging/index.js';

const logger = Logger.create({ service: 'knowb-search-tool' });

/**
 * Options for KnowB search
 */
export interface KnowBSearchOptions {
  query: string;
  kbNodeIds?: string[];
  maxResults?: number;
  scoreThreshold?: number;
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
 * KnowB API response structure
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
 * KnowB Search Tool
 * Searches GoDaddy's knowledge base for documentation
 */
export class KnowBSearchTool {
  private useProxy: boolean;
  private apiBaseUrl: string;
  private directApiUrl: string;
  private proxyToken: string;
  private ssoJwt: string;

  constructor() {
    // Get base URL from GETTY_API_URL (same env as Getty driver)
    const baseUrl = process.env.GETTY_API_URL || '';

    // Strip any path components to get clean base URL (backward compatibility)
    try {
      const urlObj = new URL(baseUrl);
      this.apiBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch {
      // If URL parsing fails, strip common path patterns
      this.apiBaseUrl = baseUrl.replace(/\/(img\/search|v1\/search|v1\/videos|v1\/knowb).*$/, '');
    }

    this.directApiUrl = process.env.KNOWB_API_URL || 'https://knowb.api.int.test-godaddy.com/v1/search';

    // Use GETTY_TOKEN for proxy auth (same as Getty driver)
    this.proxyToken = process.env.GETTY_TOKEN || '';
    this.ssoJwt = process.env.SSO_JWT || '';

    // Prefer proxy mode when GETTY_API_URL and GETTY_TOKEN are set
    this.useProxy = !!(this.apiBaseUrl && this.proxyToken);

    if (!this.useProxy && !this.ssoJwt) {
      logger.warn('knowb-search.auth.missing', {
        message: 'No auth configured. Set GETTY_API_URL + GETTY_TOKEN for hosted or SSO_JWT for local.',
      });
    }
  }

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

    const {
      query,
      kbNodeIds = ['/airo_sys'],
      maxResults = 5,
      scoreThreshold = 0.35,
    } = options;

    contextLogger.info('knowb-search.search.start', {
      query,
      kbNodeIds,
      maxResults,
      scoreThreshold,
      useProxy: this.useProxy,
    });

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      const error = 'Query must be a non-empty string';
      contextLogger.error('knowb-search.search.invalid_query', { error });
      return {
        success: false,
        error,
      };
    }

    try {
      if (this.useProxy) {
        return await this.searchViaProxy(query, kbNodeIds, maxResults, scoreThreshold, contextLogger);
      } else {
        return await this.searchDirect(query, kbNodeIds, maxResults, scoreThreshold, contextLogger);
      }
    } catch (error) {
      contextLogger.error('knowb-search.search.error', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
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
    scoreThreshold: number,
    contextLogger: ILogger
  ): Promise<KnowBSearchResult> {
    const url = `${this.apiBaseUrl}/v1/knowb/search`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.proxyToken}`,
      },
      body: JSON.stringify({
        query: query.trim(),
        kbNodeIds,
        maxResults,
        scoreThreshold,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      contextLogger.error('knowb-search.proxy.error', {
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
    return this.parseResponse(data, query, contextLogger);
  }

  /**
   * Search directly (local mode with SSO_JWT)
   */
  private async searchDirect(
    query: string,
    kbNodeIds: string[],
    maxResults: number,
    scoreThreshold: number,
    contextLogger: ILogger
  ): Promise<KnowBSearchResult> {
    if (!this.ssoJwt) {
      const error = 'No SSO_JWT configured for direct API access.';
      contextLogger.error('knowb-search.search.auth_missing', { error });
      return {
        success: false,
        error,
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

    contextLogger.info('knowb-search.api.request', {
      url: this.directApiUrl,
      query,
    });

    const response = await fetch(this.directApiUrl, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'Authorization': `sso-jwt ${this.ssoJwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      contextLogger.error('knowb-search.api.error', {
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
    return this.parseResponse(data, query, contextLogger);
  }

  /**
   * Parse API response into tool result format
   */
  private parseResponse(
    data: KnowBAPIResponse,
    query: string,
    contextLogger: ILogger
  ): KnowBSearchResult {
    const results: KnowBSearchItem[] = data.results.map((item) => ({
      location: item.location,
      content: {
        text: item.content.text,
        type: item.content.type,
      },
      score: item.score,
      metadata: item.metadata,
    }));

    contextLogger.info('knowb-search.search.success', {
      query,
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
