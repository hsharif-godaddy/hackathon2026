import { KnowledgeServiceSearchParams } from '../types/index.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import { BaseClient, BaseAPIResponse } from './base-client.js';

/**
 * Knowledge Service Client
 *
 * Proxies search requests to the internal knowledge-service REST API.
 */
class KnowledgeServiceClient extends BaseClient {
  constructor() {
    super({
      serviceName: 'KnowledgeService',
      ssoHost: config.sso.host,
      defaultRetries: 2
    });
  }

  /**
   * Search the knowledge service
   */
  async search(params: KnowledgeServiceSearchParams, requestId: string = 'unknown'): Promise<BaseAPIResponse> {
    return this.executeWithTiming(async () => {
      logger.info('KnowledgeService client config', {
        requestId,
        configuredUpstream: config.knowledgeService.upstream,
      });

      const requestBody: Record<string, unknown> = {
        query: params.query.trim(),
        topN: params.topN ?? config.knowledgeService.defaultTopN,
      };

      if (params.filters) {
        requestBody.filters = params.filters;
      }

      const searchUrl = `${config.knowledgeService.upstream}/api/v1/search`;

      logger.info('KnowledgeService API request details', {
        requestId,
        fullUrl: searchUrl,
        hostname: new URL(searchUrl).hostname,
      });

      return (await this.makeRequest(searchUrl, requestId, 'POST', JSON.stringify(requestBody))) as BaseAPIResponse;
    });
  }
}

export default new KnowledgeServiceClient();
