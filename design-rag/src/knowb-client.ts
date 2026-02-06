/**
 * KnowB Client for Design RAG
 *
 * Wraps @godaddy/goknowb-client for knowledge base operations.
 * Supports both local development (SSO_JWT) and hosted (S2S) authentication.
 */

import {
  GoKnowbClientImpl,
  TokenProvider,
  SearchType,
  type SearchKBRequest,
  type CreateKBNodeRequest
} from '@godaddy/goknowb-client';
import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';

/**
 * Search options for KnowB
 */
export interface SearchOptions {
  query: string;
  kbNodeIds?: string[];
  maxResults?: number;
  scoreThreshold?: number;
}

/**
 * Search result item
 */
export interface SearchResultItem {
  kbNodeId: string;
  text: string;
  score: number;
}

/**
 * Search result
 */
export interface SearchResult {
  success: boolean;
  results?: SearchResultItem[];
  error?: string;
}

/**
 * Upload options
 */
export interface UploadOptions {
  kbNodeId: string;
  resourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
  /**
   * KnowB chunking strategy:
   * - KNOWB001: Default, chunks into ~1000-2000 char pieces
   * - KNOWB002: No chunking, keeps as single unit
   * - KNOWBAOSSSEMANTIC300: Semantic chunking
   */
  kbStrategy?: string;
}

/**
 * Upload result
 */
export interface UploadResult {
  success: boolean;
  resourceId?: string;
  kbNodeIds?: string[];
  error?: string;
}

/**
 * Delete options
 */
export interface DeleteOptions {
  kbNodeId: string;
  resourceId: string;
}

/**
 * Delete result
 */
export interface DeleteResult {
  success: boolean;
  error?: string;
}

/**
 * Token provider that supports SSO_JWT and S2S authentication
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

    throw new Error(
      'No authentication configured. Set SSO_JWT for local or GOCODE_USE_S2S_AUTH=true for hosted.'
    );
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
 */
function getApiUrl(): string {
  const knowbUrl = process.env.KNOWB_URL || process.env.GODADDY_API_BASE_URL;
  if (knowbUrl) {
    return knowbUrl;
  }
  return 'https://knowb.api.int.test-godaddy.com';
}

/**
 * KnowB client for design RAG operations
 */
export class KnowBClient {
  private client: GoKnowbClientImpl;
  private tokenProvider: KnowBTokenProvider;
  private initialized = false;

  // Default configuration
  private static readonly DEFAULT_KB_NODE_IDS = ['/airo_info'];
  private static readonly DEFAULT_MAX_RESULTS = 5;
  private static readonly DEFAULT_SCORE_THRESHOLD = 0.35;

  constructor() {
    this.tokenProvider = new KnowBTokenProvider();
    const apiUrl = getApiUrl();
    this.client = new GoKnowbClientImpl(apiUrl, this.tokenProvider);

    if (process.env.KNOWB_CLIENT_DEBUG === 'true') {
      console.log(`KnowB client initialized with URL: ${apiUrl}`);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.tokenProvider.needsInitialization()) {
      await this.tokenProvider.initialize();
      this.initialized = true;
    }
  }

  /**
   * Search the knowledge base
   */
  async search(options: SearchOptions): Promise<SearchResult> {
    const {
      query,
      kbNodeIds = KnowBClient.DEFAULT_KB_NODE_IDS,
      maxResults = KnowBClient.DEFAULT_MAX_RESULTS,
      scoreThreshold = KnowBClient.DEFAULT_SCORE_THRESHOLD
    } = options;

    if (!query || query.trim().length === 0) {
      return { success: false, error: 'Query is required' };
    }

    if (!this.tokenProvider.hasAuth()) {
      return { success: false, error: 'No authentication configured' };
    }

    try {
      await this.ensureInitialized();

      const request: SearchKBRequest = {
        filter: {
          kbNodeIds,
          maxNumberOfResult: maxResults,
          scoreThreshold
        },
        query: query.trim(),
        searchType: SearchType.AUTO
      };

      const response = await this.client.search(request);

      const results: SearchResultItem[] = response.results.map((item) => ({
        kbNodeId: item.location.kbNodeId,
        text: item.content.text,
        score: item.score
      }));

      return { success: true, results };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Upload content to the knowledge base
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    const { kbNodeId, resourceId, content, metadata, kbStrategy } = options;

    if (!this.tokenProvider.hasAuth()) {
      return { success: false, error: 'No authentication configured' };
    }

    try {
      await this.ensureInitialized();

      const fileBuffer = Buffer.from(content, 'utf-8');

      const request: CreateKBNodeRequest = {
        files: [[`${resourceId}.md`, fileBuffer]],
        collectionKbNodeId: kbNodeId,
        resourceType: 'document',
        metadata: metadata ? { ...metadata, resourceId } : { resourceId }
      };

      if (kbStrategy) {
        request.kbStrategy = kbStrategy;
      }

      const response = await this.client.createKbNode(request);

      return {
        success: true,
        resourceId,
        kbNodeIds: response.kbNodeIds
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Delete content from the knowledge base
   */
  async delete(options: DeleteOptions): Promise<DeleteResult> {
    const { kbNodeId, resourceId } = options;

    if (!this.tokenProvider.hasAuth()) {
      return { success: false, error: 'No authentication configured' };
    }

    try {
      await this.ensureInitialized();

      const fullKbNodeId = `${kbNodeId}/${resourceId}.md`;
      await this.client.deleteKbNode({ kbNodeId: fullKbNodeId });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Sync/index a knowledge base node
   */
  async sync(kbNodeId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.tokenProvider.hasAuth()) {
      return { success: false, error: 'No authentication configured' };
    }

    try {
      await this.ensureInitialized();
      await this.client.sync({ kbNodeId });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Format search results as markdown
   */
  formatResultsAsMarkdown(results: SearchResultItem[]): string {
    if (!results || results.length === 0) {
      return 'No results found.';
    }

    return results
      .map((item, index) => {
        return `## Result ${index + 1}\n**Node:** ${item.kbNodeId}\n**Score:** ${item.score.toFixed(3)}\n\n${item.text}\n`;
      })
      .join('\n---\n\n');
  }
}
