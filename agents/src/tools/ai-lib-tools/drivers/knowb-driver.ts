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
import { getS2SToken, isS2SAuthEnabled, refreshS2SToken } from '@airo/ai-lib';
import {
  GoKnowbClientImpl,
  TokenProvider,
  SearchType,
  RerankingStrategy,
  type SearchKBRequest,
  type CreateKBNodeRequest,
} from '@godaddy/goknowb-client';

import { log, Logger, logger as rootLogger } from '../../../logging/index.js';

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

/**
 * Assumed TTL (seconds) for GoDaddy JWTs that omit the standard `exp` claim.
 * Mirrors the fallback used by @airo/ai-lib's s2s-auth.ts:266:
 *   expiresAt: payload.exp ? payload.exp * 1000 : (payload.iat + 30 * 60) * 1000
 * GoDaddy SSO tokens (typ=jomax|idp|cert) often ship with `iat` + `vat` but
 * no `exp`; ai-lib treats these as 30-min TTL and we match so the two caches
 * agree on when a refresh is needed.
 */
const NO_EXP_TTL_SECONDS = 30 * 60;

/**
 * Decode the effective expiry (unix seconds) from a JWT without verifying
 * the signature. Returns null if the token is unparseable OR if neither
 * `exp` nor `iat` is present.
 *
 * Precedence: standard `exp` → `iat + NO_EXP_TTL_SECONDS`. We do NOT use
 * GoDaddy-specific `vat` because ai-lib's cache ignores it too; using
 * different expiry sources would cause the two layers to disagree.
 *
 * Signature verification is the server's job at the other end of the
 * request. We only care about WHEN to proactively refetch.
 */
function decodeJwtExp(jwt: string): number | null {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    // Base64url -> base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, 'base64').toString('utf-8');
    const claims = JSON.parse(json) as { exp?: number; iat?: number };
    if (typeof claims.exp === 'number') return claims.exp;
    if (typeof claims.iat === 'number') return claims.iat + NO_EXP_TTL_SECONDS;
    return null;
  } catch (error) {
    // Unexpected decode/JSON failure — a JWT-format regression here disables
    // proactive refresh entirely and silently reintroduces the 1h-expiry bug
    // we're fixing. Log so the fallback is visible in Loki.
    rootLogger.warn('knowb-driver.token.exp_decode_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Seconds of headroom before JWT `exp` at which we proactively refetch.
 * 5 minutes gives ample slack for clock skew + request latency.
 */
const TOKEN_REFRESH_BUFFER_SECONDS = 300;

/**
 * Token provider that uses S2S or SSO_JWT authentication.
 *
 * Note: the @godaddy/goknowb-client `TokenProvider` interface requires a
 * synchronous `getToken()`, so we pre-fetch the S2S token and cache it here.
 * Previously the cache was set-once-forever; with a 1h S2S JWT TTL that meant
 * every container inevitably started returning 401s from GoKnowb after the
 * first hour. Now we:
 *
 *   1. Decode the JWT's `exp` claim on fetch.
 *   2. Re-fetch proactively when within TOKEN_REFRESH_BUFFER_SECONDS of exp.
 *   3. Expose `invalidateToken()` so a 401 response can force the next call
 *      to re-fetch (reactive safety net for clock skew / early revocation).
 */
class KnowBTokenProvider implements TokenProvider {
  private readonly ssoJwt: string;
  private readonly useS2S: boolean;
  private readonly ssoHost: string;
  private cachedS2SToken: string | null = null;
  // unix seconds; null when we couldn't decode exp (treat as non-refreshing).
  private cachedTokenExpSeconds: number | null = null;

  constructor() {
    this.ssoJwt = process.env.SSO_JWT || '';
    this.useS2S = isS2SAuthEnabled();
    this.ssoHost = process.env.SSO_HOST || 'sso.test-godaddy.com';
  }

  /**
   * Fetch an S2S token and update the cache + decoded-exp.
   *
   * @param forceRefresh when true, bypasses the upstream @airo/ai-lib
   *   token cache (which has its own ~60s buffer on `exp`) by calling
   *   `refreshS2SToken`. Needed on the reactive-401 path: if the 401 came
   *   from an in-flight cert rotation / early revocation, the upstream
   *   cache would otherwise hand us back the same rejected token.
   */
  async initialize(forceRefresh = false): Promise<void> {
    if (!this.useS2S) return;
    const token = forceRefresh
      ? await refreshS2SToken({ ssoHost: this.ssoHost })
      : await getS2SToken({ ssoHost: this.ssoHost });
    this.cachedS2SToken = token;
    this.cachedTokenExpSeconds = decodeJwtExp(token);
  }

  /**
   * True when we have any S2S token cached locally (fresh or stale).
   * Used by the driver to distinguish a true initial-fetch failure (no
   * cached token, fast-fail is safe) from a transient proactive-refresh
   * failure (we still have a usable-ish token — let subsequent calls retry).
   */
  hasCachedToken(): boolean {
    return this.cachedS2SToken !== null;
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

  /**
   * True when `initialize()` must be called before `getToken()` will work.
   * Also true when the cached S2S token is within the refresh buffer of
   * its `exp` — this is what fixes the "dead JWT after 1h" bug.
   */
  needsInitialization(): boolean {
    if (!this.useS2S) return false;
    if (!this.cachedS2SToken) return true;
    if (this.cachedTokenExpSeconds === null) {
      // Un-decodable token: we can't do proactive refresh, so fall back to
      // the old "cache until explicitly invalidated" behavior. A reactive
      // 401 in the driver will call invalidateToken().
      return false;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    return nowSeconds >= this.cachedTokenExpSeconds - TOKEN_REFRESH_BUFFER_SECONDS;
  }

  /**
   * Drop the cached token so the next `needsInitialization()` returns true
   * and the next `initialize()` call re-fetches.
   *
   * Called by the driver on 401 responses from GoKnowb (reactive refresh).
   */
  invalidateToken(): void {
    this.cachedS2SToken = null;
    this.cachedTokenExpSeconds = null;
  }

  /**
   * For observability / tests — returns the cached JWT's `exp` in unix
   * seconds, or null if none cached / undecodable.
   */
  getCachedTokenExpSeconds(): number | null {
    return this.cachedTokenExpSeconds;
  }
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
 * Wraps the official @godaddy/goknowb-client
 */
export class KnowBDriver {
  protected logger: Logger;
  private client: GoKnowbClientImpl;
  private tokenProvider: KnowBTokenProvider;
  private initFailure: Error | null = null;

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
    this.logger = Logger.create({ component: 'knowb-driver' });
    this.tokenProvider = new KnowBTokenProvider();

    const apiUrl = getApiUrl();
    this.client = new GoKnowbClientImpl(apiUrl, this.tokenProvider);

    this.logger.info('knowb-driver.config.initialized', {
      apiUrl,
      hasAuth: this.tokenProvider.hasAuth(),
    });
  }

  /**
   * Ensure the driver is ready to make an authenticated call.
   *
   * Runs on every search/upload/delete/sync — `tokenProvider.needsInitialization()`
   * returns true both on first use and when the cached S2S JWT is within the
   * refresh buffer of its `exp`, so this is also the proactive-refresh hook.
   *
   * On first S2S-fetch failure we cache the error and fail fast on subsequent
   * calls, so a single SSO outage doesn't flood Loki with N identical
   * `knowb-driver.init.s2s_token_failed` entries. A successful refresh clears
   * the cache — we don't want a 30s transient outage to permanently wedge
   * the process.
   */
  private async ensureInitialized(forceRefresh = false): Promise<void> {
    // Only fast-fail when we have no cached token at all — a true initial
    // fetch failure. If we have a cached token but proactive-refresh just
    // failed, the old token may still be accepted for a few more minutes
    // and the SSO outage may be transient. Clearing initFailure on any
    // successful init (or when no refresh is needed) lets the driver
    // self-heal.
    if (this.initFailure && !this.tokenProvider.hasCachedToken()) {
      throw this.initFailure;
    }
    if (!forceRefresh && !this.tokenProvider.needsInitialization()) {
      this.initFailure = null;
      return;
    }
    try {
      await this.tokenProvider.initialize(forceRefresh);
      this.initFailure = null;
    } catch (error) {
      this.initFailure = error as Error;
      log.error(this.logger, 'knowb-driver.init.s2s_token_failed', error as Error);
      throw error;
    }
  }

  /**
   * Inspect a thrown error from @godaddy/goknowb-client to decide if it's a
   * 401 worth retrying with a fresh token. Client error messages look like:
   *   "Error performing KB search: Request failed with status code 401"
   * The AxiosError also has `.response?.status`.
   */
  private isUnauthorizedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { response?: { status?: number }; message?: string };
    if (e.response?.status === 401) return true;
    return typeof e.message === 'string' && /status code 401\b/.test(e.message);
  }

  /**
   * Wrap an SDK call in a one-shot 401 retry.
   *
   * On 401: invalidate the local token snapshot, force a fresh upstream
   * fetch via ensureInitialized(forceRefresh=true) — this bypasses ai-lib's
   * own ~60s token cache, otherwise we'd retry with the same rejected JWT
   * — then retry the SDK call exactly once. Only 401 triggers the retry;
   * non-auth errors flow through unchanged. Used by search/upload/delete/sync
   * so any KB op self-heals from mid-session cert rotation or revocation.
   */
  private async withRetryOn401<T>(
    operation: string,
    logContext: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    try {
      return await run();
    } catch (error) {
      if (!this.isUnauthorizedError(error)) throw error;
      this.logger.warn(`knowb-driver.${operation}.reauth_retry`, logContext);
      this.tokenProvider.invalidateToken();
      this.initFailure = null;
      await this.ensureInitialized(true);
      return run();
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
      this.logger.warn('knowb-driver.search.no_auth', {
        query: query.substring(0, 100),
      });
      return {
        success: false,
        error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
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
      if (!this.tokenProvider.hasAuth()) {
        this.logger.warn('knowb-driver.upload.no_auth', { resourceId, kbNodeId });
        return {
          success: false,
          error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
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
      if (!this.tokenProvider.hasAuth()) {
        this.logger.warn('knowb-driver.delete.no_auth', { resourceId, kbNodeId });
        return {
          success: false,
          error: 'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.',
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
      if (!this.tokenProvider.hasAuth()) {
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
