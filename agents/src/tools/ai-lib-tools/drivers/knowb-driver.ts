/**
 * KnowB Knowledge Base Driver
 *
 * Wraps @godaddy/goknowb-client for knowledge base operations.
 * Extends BaseDriverV2 for S2S authentication (USE_S2S_AUTH + S2S_AWS_PROFILE)
 * with SSO_JWT fallback for local development.
 *
 * API URL: KNOWB_URL > GODADDY_API_BASE_URL > test environment fallback
 */
import {
  GoKnowbClientImpl,
  type TokenProvider,
  SearchType,
  RerankingStrategy,
  type SearchKBRequest,
  type CreateKBNodeRequest,
} from '@godaddy/goknowb-client';

import { log, logger as rootLogger } from '../../../logging/index.js';
import { BaseDriverV2 } from './base-driver-v2.js';

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
 * Deduplicate search results by `kbNodeId`, keeping the highest-scoring
 * occurrence per document. Bedrock returns chunk-level hits; multiple chunks
 * of the same document can occupy top-K slots, starving other relevant docs.
 *
 * Sorts by score desc internally so the result is correct regardless of
 * input order — callers don't need to pre-sort.
 */
export function dedupByKbNodeId(results: KnowBResultItem[]): KnowBResultItem[] {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: KnowBResultItem[] = [];
  for (const r of sorted) {
    if (seen.has(r.kbNodeId)) continue;
    seen.add(r.kbNodeId);
    out.push(r);
  }
  return out;
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

const TEST_FALLBACK_URL = 'https://knowb.api.int.test-godaddy.com';

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
  // Fallback to test environment — warn loudly when this happens outside local
  // or the unit-test runner, because a misconfigured prod container would
  // silently hit TEST KB otherwise.
  const gasket = process.env.GASKET_ENV || '';
  const nodeEnv = process.env.NODE_ENV || '';
  const isLocalOrTestRunner = gasket.startsWith('local') || nodeEnv === 'test';
  if (!isLocalOrTestRunner) {
    // Use structured logger (not console.warn) so Loki / LOG_LEVEL filters
    // capture the warning. A silent TEST-KB fallback in prod is exactly the
    // kind of misconfiguration alerting needs to see.
    rootLogger.warn('knowb-driver.config.api_url_fallback', {
      gasketEnv: gasket,
      nodeEnv,
      fallbackUrl: TEST_FALLBACK_URL,
      message: 'KNOWB_URL / GODADDY_API_BASE_URL unset — falling back to TEST KB. Almost certainly wrong for non-local envs.',
    });
  }
  return TEST_FALLBACK_URL;
}

/**
 * KnowB Knowledge Base Driver
 * Wraps the official @godaddy/goknowb-client with BaseDriverV2 auth.
 *
 * Auth, token caching, proactive refresh, and 401 retry are all inherited
 * from BaseDriverV2. The SDK's sync `TokenProvider.getToken()` is bridged
 * to BaseDriverV2's cached token via a thin adapter.
 */
export class KnowBDriver extends BaseDriverV2 {
  private client: GoKnowbClientImpl;

  // Default configuration
  // See docs: GoKnowb RAG Configuration Reference (Confluence) + plan 2026-05-04.
  private static readonly DEFAULT_KB_NODE_IDS = ['/airo_info'];
  /**
   * Final top-K returned to callers (post-dedup).
   *
   * Set to 2 because the current /airo_info corpus is 3 docs; topK=3 would
   * inject every doc on every turn (noise for off-topic queries, wasted
   * prompt tokens). With 2, the agent gets the best match plus a single
   * complementary hit for ambiguous queries, and irrelevant queries still
   * get 2 low-score docs the caller can gate on. Revisit as the corpus
   * grows — aim for ~60% of doc count, capped at 5.
   */
  private static readonly DEFAULT_MAX_RESULTS = 2;
  /**
   * Over-fetch count: Bedrock/Cohere candidates we request, then dedup + trim
   * client-side. Kept at 15 independent of final top-K — gives Cohere rerank
   * a broad input set and leaves headroom for chunk-level duplicates.
   */
  private static readonly OVER_FETCH_COUNT = 15;
  /**
   * Explicit score threshold of 0.0. Bedrock's default is 0.5 — applied
   * server-side to Cohere rerank scores it would filter out nearly all
   * relevant results (empirically measured 0.06–0.57 range). We let Cohere
   * rerank ordering + top-K do the selection instead.
   */
  private static readonly DEFAULT_SCORE_THRESHOLD = 0.0;

  constructor() {
    const apiUrl = getApiUrl();
    super({ serviceName: 'knowb-driver', baseUrl: apiUrl });

    // The goknowb-client SDK requires a sync TokenProvider. BaseDriverV2
    // pre-fetches the token async (via ensureInitialized before each op),
    // so getAuthToken() always returns the cached value synchronously.
    const tokenProvider: TokenProvider = {
      getToken: () => this.getAuthToken(),
    };

    this.client = new GoKnowbClientImpl(apiUrl, tokenProvider);
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

    if (!this.hasAuth()) {
      this.logger.warn('knowb-driver.search.no_auth', {
        query: query.substring(0, 100),
      });
      return {
        success: false,
        error: 'No authentication configured. Set USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
      };
    }

    // Over-fetch Cohere-reranked candidates, then dedup + trim client-side.
    // Bedrock rerank score replaces raw cosine in `item.score`.
    const request: SearchKBRequest = {
      filter: {
        kbNodeIds,
        maxNumberOfResult: KnowBDriver.OVER_FETCH_COUNT,
        scoreThreshold,
      },
      query: query.trim(),
      searchType: SearchType.LEXICAL_AND_SEMANTIC,
      rerankingConfig: {
        type: RerankingStrategy.COHERE,
        results: KnowBDriver.OVER_FETCH_COUNT,
      },
    };

    try {
      const response = await this.withRetryOn401(
        'search',
        { query: query.substring(0, 100) },
        () => this.client.search(request),
      );

      if (!Array.isArray(response.results)) {
        this.logger.warn('knowb-driver.search.unexpected_response_shape', {
          query: query.substring(0, 100),
          resultsType: typeof response.results,
        });
      }
      const rawResults: KnowBResultItem[] = (response.results ?? []).map((item) => ({
        kbNodeId: item.location.kbNodeId,
        text: item.content.text,
        // Guard against missing score on the external API response. The type
        // says number but a regression upstream would otherwise propagate
        // undefined all the way to `.toFixed(4)` and crash the tool.
        score: item.score ?? 0,
      }));

      const results = dedupByKbNodeId(rawResults).slice(0, maxResults);

      this.logger.info('knowb-driver.search.success', {
        query: query.substring(0, 100),
        totalResults: results.length,
        // raw number for numeric filtering in Loki/Grafana (not .toFixed string)
        topScore: results[0]?.score,
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
      if (!this.hasAuth()) {
        this.logger.warn('knowb-driver.upload.no_auth', { resourceId, kbNodeId });
        return {
          success: false,
          error: 'No authentication configured. Set USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
        };
      }

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

      const response = await this.withRetryOn401(
        'upload',
        { resourceId, kbNodeId },
        () => this.client.createKbNode(request),
      );

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
        kbNodeId,
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
      if (!this.hasAuth()) {
        this.logger.warn('knowb-driver.delete.no_auth', { resourceId, kbNodeId });
        return {
          success: false,
          error: 'No authentication configured. Set USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
        };
      }

      // Construct the full kbNodeId path including the resource filename
      const fullKbNodeId = `${kbNodeId}/${resourceId}.md`;

      await this.withRetryOn401(
        'delete',
        { resourceId, kbNodeId },
        () => this.client.deleteKbNode({ kbNodeId: fullKbNodeId }),
      );

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
        kbNodeId,
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
      if (!this.hasAuth()) {
        this.logger.warn('knowb-driver.sync.no_auth', { kbNodeId });
        return {
          success: false,
          error: 'No authentication configured.',
        };
      }

      await this.withRetryOn401(
        'sync',
        { kbNodeId },
        () => this.client.sync({ kbNodeId }),
      );

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
