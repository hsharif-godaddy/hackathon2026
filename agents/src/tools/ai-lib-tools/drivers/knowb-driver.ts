/**
 * KnowB Knowledge Base Driver
 *
 * Handles knowledge base search through direct API calls
 *
 * Configuration:
 * - GODADDY_API_BASE_URL: KnowB API URL (required)
 * - SSO_HOST: SSO host for authentication (optional, defaults to sso.test-godaddy.com)
 * - S2S mode: GOCODE_USE_S2S_AUTH=true (uses gd-auth-client for tokens)
 * - Local mode: SSO_JWT (uses sso-jwt token directly)
 */
import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';

import { log, Logger } from '../../../logging/index.js';

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
 * Options for uploading to KnowB
 */
export interface KnowBUploadOptions {
  kbNodeId: string;
  resourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
  /** Optional header to prepend to content. If provided, creates "# {header}: {resourceId}" */
  header?: string;
}

/**
 * Result from KnowB upload
 */
export interface KnowBUploadResult {
  success: boolean;
  resourceId?: string;
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
  protected logger: Logger;
  private apiUrl: string;
  private ssoJwt: string;
  private ssoHost: string;
  private useS2S: boolean;

  // Default configuration matching proxy
  private static readonly DEFAULT_KB_NODE_IDS = ['/airo_info'];
  private static readonly DEFAULT_MAX_RESULTS = 5;
  private static readonly DEFAULT_SCORE_THRESHOLD = 0.35;

  constructor() {
    this.logger = Logger.create({ service: 'knowb-driver' });

    // Setup authentication mode
    this.ssoJwt = process.env.SSO_JWT || '';
    this.useS2S = isS2SAuthEnabled();
    this.ssoHost = process.env.SSO_HOST || 'sso.test-godaddy.com';

    // Set API URL from environment (required)
    this.apiUrl = process.env.GODADDY_API_BASE_URL || '';

    this.logger.info('knowb-driver.config.initialized', {
      useS2S: this.useS2S,
      hasSsoJwt: !!this.ssoJwt,
      apiUrl: this.apiUrl,
      ssoHost: this.ssoHost,
    });

    if (!this.apiUrl) {
      this.logger.warn('knowb-driver.config.missing', {
        message: 'GODADDY_API_BASE_URL environment variable is not set.',
      });
    }

    if (!this.hasAuth()) {
      this.logger.warn('knowb-driver.auth.missing', {
        message: 'No auth configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
      });
    }

    this.logger.info('knowb-driver.auth.mode', {
      mode: this.useS2S ? 'S2S' : (this.ssoJwt ? 'SSO_JWT' : 'none'),
    });
  }

  /**
   * Get authorization header based on auth mode
   * Priority: S2S (hosted) > SSO_JWT (local)
   */
  private async getAuthHeader(): Promise<string> {
    if (this.useS2S) {
      const token = await getS2SToken({ ssoHost: this.ssoHost });
      return `sso-jwt ${token}`;
    }

    if (this.ssoJwt) {
      return `sso-jwt ${this.ssoJwt}`;
    }

    throw new Error('No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.');
  }

  /**
   * Check if authentication is configured
   */
  private hasAuth(): boolean {
    return this.useS2S || !!this.ssoJwt;
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
      kbNodeIds = KnowBDriver.DEFAULT_KB_NODE_IDS,
      maxResults = KnowBDriver.DEFAULT_MAX_RESULTS,
      scoreThreshold = KnowBDriver.DEFAULT_SCORE_THRESHOLD,
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
      useS2S: this.useS2S,
    });

    if (!this.apiUrl) {
      return {
        success: false,
        error: 'GODADDY_API_BASE_URL environment variable is not configured.',
      };
    }

    if (!this.hasAuth()) {
      return {
        success: false,
        error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
      };
    }

    try {
      const authHeader = await this.getAuthHeader();

      const url = `${this.apiUrl}/v1/search`;
      const requestBody = {
        filter: {
          kbNodeIds,
          maxNumberOfResult: maxResults,
          scoreThreshold,
        },
        query: query.trim(),
        searchType: 'auto',
      };

      this.logger.info('knowb-driver.api.request', {
        url,
        query: query.substring(0, 100),
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
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

  /**
   * Upload content to the knowledge base
   *
   * @param options - Upload options containing content and metadata
   * @returns Promise resolving to upload result
   */
  async upload(options: KnowBUploadOptions): Promise<KnowBUploadResult> {
    const { kbNodeId, resourceId, content, metadata, header } = options;

    this.logger.info('knowb-driver.upload.begin', {
      kbNodeId,
      resourceId,
      contentLength: content.length,
    });

    try {
      if (!this.hasAuth()) {
        return {
          success: false,
          error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
        };
      }

      const authHeader = await this.getAuthHeader();

      // Create markdown content, optionally with header
      const markdownContent = header
        ? `# ${header}: ${resourceId}\n\n${content}`
        : content;
      const blob = new Blob([markdownContent], { type: 'text/markdown' });
      const formData = new FormData();
      formData.append('file', blob, `${resourceId}.md`);
      formData.append('kbNodeId', kbNodeId);
      formData.append('resourceType', 'document');
      if (metadata) {
        formData.append('metadata', JSON.stringify({ ...metadata, resourceId }));
      }

      const url = `${this.apiUrl}/v1/knowb/upload`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('knowb-driver.upload.error', {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        return {
          success: false,
          error: `KnowB upload error: ${response.status} ${response.statusText}`,
        };
      }

      this.logger.info('knowb-driver.upload.success', {
        resourceId,
        kbNodeId,
      });

      return {
        success: true,
        resourceId,
      };
    } catch (error) {
      this.logger.error('knowb-driver.upload.exception', {
        resourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: `KnowB upload failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

/**
 * Singleton instance for convenience
 */
export const knowBDriver = new KnowBDriver();
