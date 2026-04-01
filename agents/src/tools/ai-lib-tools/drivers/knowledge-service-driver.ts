/**
 * Knowledge Service Driver
 *
 * Calls the internal knowledge-service REST API for RAG retrieval.
 * Provides the same search interface as KnowBDriver so it can be
 * used as a drop-in replacement.
 *
 * Configuration:
 * - Direct mode: KNOWLEDGE_SERVICE_URL (calls knowledge-service directly)
 * - Proxy mode: KNOWLEDGE_PROXY_URL (routes through airo-proxy, e.g. https://proxy-host/v1/knowledge)
 *   - Auth: GETTY_TOKEN (Bearer token for proxy). Note: this reuses the Getty Images proxy
 *     token because airo-proxy is a shared proxy that handles both Getty Images and
 *     knowledge-service routes. The same Bearer token authenticates all proxy requests.
 *     A dedicated KNOWLEDGE_PROXY_TOKEN would be cleaner long-term but requires alloc changes.
 * - S2S mode: GOCODE_USE_S2S_AUTH=true (uses gd-auth-client for tokens)
 * - Local mode: SSO_JWT (uses sso-jwt token directly)
 */
import { getS2SToken, isS2SAuthEnabled } from '@airo/ai-lib';

import { log, Logger } from '../../../logging/index.js';
import type { KnowBResultItem, KnowBSearchOptions, KnowBSearchResult } from './knowb-driver.js';

interface KnowledgeServiceSearchResult {
  docName: string;
  sectionPath: string;
  content: string;
  score: number;
  chunkIndex: number;
}

interface KnowledgeServiceSearchResponse {
  results: KnowledgeServiceSearchResult[];
  meta: {
    total: number;
    query: string;
    searchDurationMs: number;
  };
}

/**
 * Get knowledge service URL from environment.
 * Checks KNOWLEDGE_SERVICE_URL (direct mode) first, then KNOWLEDGE_PROXY_URL (proxy mode).
 * Returns null if neither is configured, signalling the driver is disabled.
 */
export function getKnowledgeServiceUrl(): string | null {
  return process.env.KNOWLEDGE_SERVICE_URL || process.env.KNOWLEDGE_PROXY_URL || null;
}

/**
 * Lazily-initialized singleton. Created on first access.
 * Prefers direct mode (KNOWLEDGE_SERVICE_URL) over proxy mode (KNOWLEDGE_PROXY_URL).
 * Returns null when neither env var is configured.
 */
let _knowledgeServiceDriver: KnowledgeServiceDriver | null | undefined;

export function getKnowledgeServiceDriver(): KnowledgeServiceDriver | null {
  if (_knowledgeServiceDriver === undefined) {
    const directUrl = process.env.KNOWLEDGE_SERVICE_URL;
    const proxyUrl = process.env.KNOWLEDGE_PROXY_URL;

    if (directUrl) {
      _knowledgeServiceDriver = new KnowledgeServiceDriver(directUrl, false);
    } else if (proxyUrl) {
      _knowledgeServiceDriver = new KnowledgeServiceDriver(proxyUrl, true);
    } else {
      _knowledgeServiceDriver = null;
    }
  }
  return _knowledgeServiceDriver;
}

/**
 * Driver for the airo knowledge-service REST API.
 * Re-exports the same result types as KnowBDriver for easy substitution.
 */
export class KnowledgeServiceDriver {
  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly useProxy: boolean;
  private cachedS2SToken: string | null = null;
  private cachedS2STokenExpiry: number = 0;
  // S2S tokens expire; refresh 5 minutes before expiry to avoid 401s in long-running processes
  private static readonly S2S_TOKEN_TTL_MS = 55 * 60 * 1000; // 55 min (tokens valid 1h)

  private static readonly DEFAULT_TOP_N = 5;
  private static readonly DEFAULT_SCORE_THRESHOLD = 0.67;
  private static readonly REQUEST_TIMEOUT_MS = 5_000;

  constructor(baseUrl: string, useProxy: boolean = false) {
    this.logger = Logger.create({ component: 'knowledge-service-driver' });
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.useProxy = useProxy;
    this.logger.info('knowledge-service-driver.config.initialized', {
      baseUrl: this.baseUrl,
      mode: useProxy ? 'proxy' : 'direct',
    });
  }

  private async getAuthHeader(): Promise<string> {
    if (this.useProxy) {
      // GETTY_TOKEN is the shared auth token for the airo-proxy service.
      // The same proxy handles both Getty Images and knowledge-service routes,
      // so the existing GETTY_TOKEN is reused here rather than introducing a
      // separate env var for the proxy layer.
      const proxyToken = process.env.GETTY_TOKEN;
      if (proxyToken) {
        return `Bearer ${proxyToken}`;
      }
      // Fall through to SSO_JWT for local dev with proxy
    }

    if (isS2SAuthEnabled()) {
      if (!this.cachedS2SToken || Date.now() >= this.cachedS2STokenExpiry) {
        this.cachedS2SToken = await getS2SToken({
          ssoHost: process.env.SSO_HOST || 'sso.test-godaddy.com',
        });
        this.cachedS2STokenExpiry = Date.now() + KnowledgeServiceDriver.S2S_TOKEN_TTL_MS;
      }
      return `sso-jwt ${this.cachedS2SToken}`;
    }

    const ssoJwt = process.env.SSO_JWT;
    if (ssoJwt) {
      return `sso-jwt ${ssoJwt}`;
    }

    throw new Error(
      'No authentication configured. Set GOCODE_USE_S2S_AUTH=true for hosted or SSO_JWT for local.'
    );
  }

  async search(options: KnowBSearchOptions): Promise<KnowBSearchResult> {
    const {
      query,
      maxResults = KnowledgeServiceDriver.DEFAULT_TOP_N,
      scoreThreshold = KnowledgeServiceDriver.DEFAULT_SCORE_THRESHOLD,
    } = options;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return { success: false, error: 'A valid search query is required' };
    }

    const searchPath = this.useProxy ? '/search' : '/api/v1/search';

    this.logger.info('knowledge-service-driver.search.begin', {
      query: query.substring(0, 100),
      maxResults,
      scoreThreshold,
      mode: this.useProxy ? 'proxy' : 'direct',
    });

    try {
      const authHeader = await this.getAuthHeader();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), KnowledgeServiceDriver.REQUEST_TIMEOUT_MS);

      const response = await fetch(`${this.baseUrl}${searchPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ query: query.trim(), topN: maxResults }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = (await response.json()) as KnowledgeServiceSearchResponse;

      const results: KnowBResultItem[] = data.results
        .filter((item) => item.score >= scoreThreshold)
        .map((item) => ({
          kbNodeId: item.sectionPath || item.docName,
          text: item.content,
          score: item.score,
        }));

      this.logger.info('knowledge-service-driver.search.success', {
        query: query.substring(0, 100),
        totalResults: results.length,
        topScore: results[0]?.score.toFixed(3),
        durationMs: data.meta.searchDurationMs,
      });

      return { success: true, results, totalResults: results.length };
    } catch (error) {
      log.error(this.logger, 'knowledge-service-driver.search.error', error as Error, {
        query: query.substring(0, 100),
      });

      return {
        success: false,
        error: `Knowledge service search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Format results as markdown for context injection.
   * Matches the format used by KnowBDriver.formatResultsAsMarkdown().
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
