/**
 * KnowB Knowledge Base Driver
 *
 * Wraps @godaddy/goknowb-client for knowledge base operations.
 *
 * Configuration:
 * - S2S mode: GOCODE_USE_S2S_AUTH=true (uses gd-auth-client for tokens)
 * - Local mode: SSO_JWT (uses sso-jwt token directly)
 * - API URL: GODADDY_API_BASE_URL (defaults to test environment)
 */
import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';
import {
  GoKnowbClientImpl,
  TokenProvider,
  SearchType,
  type SearchKBRequest,
  type CreateKBNodeRequest,
} from '@godaddy/goknowb-client';

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
  /**
   * KnowB chunking strategy:
   * - KNOWB001: Default, chunks documents into ~1000-2000 char pieces
   * - KNOWB002: No chunking, keeps document as single unit (best for retrieval)
   * - KNOWBAOSSSEMANTIC300: Semantic chunking, many smaller pieces
   */
  kbStrategy?: string;
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
 * Options for deleting from KnowB
 */
export interface KnowBDeleteOptions {
  kbNodeId: string;
  resourceId: string;
}

/**
 * Result from KnowB delete
 */
export interface KnowBDeleteResult {
  success: boolean;
  error?: string;
}

/**
 * Token provider that uses S2S or SSO_JWT authentication
 *
 * Note: The TokenProvider interface requires synchronous getToken().
 * For S2S mode, we pre-fetch and cache the token. The token is refreshed
 * on each KnowBDriver instantiation.
 */
class KnowBTokenProvider implements TokenProvider {
  private readonly ssoJwt: string;
  private readonly useS2S: boolean;
  private readonly ssoHost: string;
  private cachedS2SToken: string | null = null;

  constructor() {
    this.ssoJwt = process.env.SSO_JWT || '';
    this.useS2S = isS2SAuthEnabled();
    this.ssoHost = process.env.SSO_HOST || 'sso.test-godaddy.com';
  }

  /**
   * Pre-fetch S2S token (call this before using the provider in S2S mode)
   */
  async initialize(): Promise<void> {
    if (this.useS2S && !this.cachedS2SToken) {
      this.cachedS2SToken = await getS2SToken({ ssoHost: this.ssoHost });
    }
  }

  getToken(): string {
    if (this.useS2S) {
      if (!this.cachedS2SToken) {
        throw new Error('S2S token not initialized. Call initialize() first.');
      }
      return `sso-jwt ${this.cachedS2SToken}`;
    }

    if (this.ssoJwt) {
      return `sso-jwt ${this.ssoJwt}`;
    }

    throw new Error('No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.');
  }

  hasAuth(): boolean {
    return this.useS2S || !!this.ssoJwt;
  }

  needsInitialization(): boolean {
    return this.useS2S && !this.cachedS2SToken;
  }
}

/**
 * Get KnowB API URL from environment
 * Priority: KNOWB_URL > GODADDY_API_BASE_URL > test environment fallback
 */
function getApiUrl(): string {
  // Prefer dedicated KNOWB_URL, fall back to GODADDY_API_BASE_URL for backward compatibility
  const knowbUrl = process.env.KNOWB_URL || process.env.GODADDY_API_BASE_URL;
  if (knowbUrl) {
    return knowbUrl;
  }
  // Fallback to test environment
  return 'https://knowb.api.int.test-godaddy.com';
}

/**
 * KnowB Knowledge Base Driver
 * Wraps the official @godaddy/goknowb-client
 */
export class KnowBDriver {
  protected logger: Logger;
  private client: GoKnowbClientImpl;
  private tokenProvider: KnowBTokenProvider;
  private initialized: boolean = false;

  // Default configuration
  private static readonly DEFAULT_KB_NODE_IDS = ['/airo_info'];
  private static readonly DEFAULT_MAX_RESULTS = 5;
  private static readonly DEFAULT_SCORE_THRESHOLD = 0.35;

  constructor() {
    this.logger = Logger.create({ service: 'knowb-driver' });
    this.tokenProvider = new KnowBTokenProvider();

    const apiUrl = getApiUrl();
    this.client = new GoKnowbClientImpl(apiUrl, this.tokenProvider);

    this.logger.info('knowb-driver.config.initialized', {
      apiUrl,
      hasAuth: this.tokenProvider.hasAuth(),
    });
  }

  /**
   * Ensure the driver is initialized (fetches S2S token if needed)
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.tokenProvider.needsInitialization()) {
      await this.tokenProvider.initialize();
      this.initialized = true;
    }
  }

  /**
   * Search the knowledge base
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
    });

    if (!this.tokenProvider.hasAuth()) {
      return {
        success: false,
        error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
      };
    }

    try {
      await this.ensureInitialized();

      const request: SearchKBRequest = {
        filter: {
          kbNodeIds,
          maxNumberOfResult: maxResults,
          scoreThreshold,
        },
        query: query.trim(),
        searchType: SearchType.AUTO,
      };

      const response = await this.client.search(request);

      const results: KnowBResultItem[] = response.results.map((item) => ({
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
   */
  async upload(options: KnowBUploadOptions): Promise<KnowBUploadResult> {
    const { kbNodeId, resourceId, content, metadata, header, kbStrategy } = options;

    this.logger.info('knowb-driver.upload.begin', {
      kbNodeId,
      resourceId,
      contentLength: content.length,
      kbStrategy,
    });

    try {
      if (!this.tokenProvider.hasAuth()) {
        return {
          success: false,
          error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
        };
      }

      await this.ensureInitialized();

      // Create markdown content, optionally with header
      const markdownContent = header ? `# ${header}: ${resourceId}\n\n${content}` : content;

      // Create a Buffer from the content
      const fileBuffer = Buffer.from(markdownContent, 'utf-8');

      const request: CreateKBNodeRequest = {
        files: [[`${resourceId}.md`, fileBuffer]],
        collectionKbNodeId: kbNodeId,
        resourceType: 'document',
        metadata: metadata ? { ...metadata, resourceId } : { resourceId },
      };

      // Only include kbStrategy when explicitly provided to avoid sending undefined
      if (kbStrategy) {
        request.kbStrategy = kbStrategy;
      }

      const response = await this.client.createKbNode(request);

      this.logger.info('knowb-driver.upload.success', {
        resourceId,
        kbNodeId,
        kbNodeIds: response.kbNodeIds,
      });

      return {
        success: true,
        resourceId,
      };
    } catch (error) {
      log.error(this.logger, 'knowb-driver.upload.error', error as Error, {
        resourceId,
      });
      return {
        success: false,
        error: `KnowB upload failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete content from the knowledge base
   */
  async delete(options: KnowBDeleteOptions): Promise<KnowBDeleteResult> {
    const { kbNodeId, resourceId } = options;

    this.logger.info('knowb-driver.delete.begin', {
      kbNodeId,
      resourceId,
    });

    try {
      if (!this.tokenProvider.hasAuth()) {
        return {
          success: false,
          error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
        };
      }

      await this.ensureInitialized();

      // Construct the full kbNodeId path including the resource filename
      const fullKbNodeId = `${kbNodeId}/${resourceId}.md`;

      await this.client.deleteKbNode({ kbNodeId: fullKbNodeId });

      this.logger.info('knowb-driver.delete.success', {
        resourceId,
        kbNodeId,
      });

      return {
        success: true,
      };
    } catch (error) {
      log.error(this.logger, 'knowb-driver.delete.error', error as Error, {
        resourceId,
      });
      return {
        success: false,
        error: `KnowB delete failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Sync a knowledge base node to trigger indexing
   */
  async sync(kbNodeId: string): Promise<{ success: boolean; error?: string }> {
    this.logger.info('knowb-driver.sync.begin', { kbNodeId });

    try {
      if (!this.tokenProvider.hasAuth()) {
        return {
          success: false,
          error: 'No authentication configured.',
        };
      }

      await this.ensureInitialized();
      await this.client.sync({ kbNodeId });

      this.logger.info('knowb-driver.sync.success', { kbNodeId });
      return { success: true };
    } catch (error) {
      log.error(this.logger, 'knowb-driver.sync.error', error as Error, {
        kbNodeId,
      });
      return {
        success: false,
        error: `KnowB sync failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get the underlying client for advanced operations
   */
  getClient(): GoKnowbClientImpl {
    return this.client;
  }
}

/**
 * Singleton instance for convenience
 */
export const knowBDriver = new KnowBDriver();
