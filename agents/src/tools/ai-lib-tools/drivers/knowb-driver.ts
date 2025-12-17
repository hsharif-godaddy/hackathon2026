/**
 * KnowB Knowledge Base Driver
 *
 * Handles knowledge base search through the proxy or direct API
 * - Proxy mode: Uses PROXY_URL with GETTY_TOKEN for authentication
 * - Direct mode: Uses SSO_JWT for local development
 */
import { Logger, log } from '../../../logging/index.js';

const logger = Logger.create({ service: 'knowb-driver' });

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
export class KnowBDriver {
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

    logger.info('knowb-driver.config.initialized', {
      useProxy: this.useProxy,
      apiBaseUrl: this.useProxy ? this.apiBaseUrl : undefined,
      directApiUrl: !this.useProxy ? this.directApiUrl : undefined,
      hasProxyToken: !!this.proxyToken,
      hasSsoJwt: !!this.ssoJwt,
    });

    if (!this.useProxy && !this.ssoJwt) {
      logger.warn('knowb-driver.auth.missing', {
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

    logger.info('knowb-driver.search.begin', {
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
      log.error(logger, 'knowb-driver.search.error', error as Error, {
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
      logger.error('knowb-driver.proxy.error', {
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
    if (!this.ssoJwt) {
      return {
        success: false,
        error: 'No SSO_JWT configured for direct API access.',
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
      headers: {
        'accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `sso-jwt ${this.ssoJwt}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('knowb-driver.api.error', {
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

    logger.info('knowb-driver.search.success', {
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
