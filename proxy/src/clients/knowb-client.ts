import { KnowBSearchParams, KnowBAPIResponse, KnowBUploadParams } from '../types/index.js';
import ssoClient from '../auth/sso-client.js';
import logger from '../utils/logger.js';
import { config } from '../config/index.js';
import { BaseClient, BaseAPIResponse } from './base-client.js';

/**
 * Decode JWT token payload (without verification)
 * Used for debugging to understand token type
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {return null;}
    const payload = parts[1];
    if (!payload) {return null;}
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * KnowB Client
 *
 * Handles requests to the KnowB knowledge base API for semantic search
 */
class KnowBClient extends BaseClient {
  constructor() {
    super({
      serviceName: 'KnowB',
      ssoHost: config.sso.host,
      defaultRetries: 2
    });
  }
  /**
   * Search the knowledge base
   *
   * @param params - Search parameters including query and filters
   * @param requestId - Request ID for logging
   * @returns Promise resolving to API response
   */
  async search(params: KnowBSearchParams, requestId: string = 'unknown'): Promise<KnowBAPIResponse> {
    return this.executeWithTiming(async () => {
      // Log the configuration being used
      logger.info('KnowB client config', {
        requestId,
        configuredUpstream: config.knowb.upstream,
        configuredDefaultKbNodeIds: config.knowb.defaultKbNodeIds,
        envKnowbUpstream: process.env.KNOWB_UPSTREAM ?? '(not set, using default)'
      });

      const jwtToken = await this.getToken();

      // Decode token to understand its type
      const tokenPayload = decodeJwtPayload(jwtToken);
      logger.info('[KnowB] SSO token obtained', {
        requestId,
        tokenLength: jwtToken.length,
        tokenType: tokenPayload?.typ,
        tokenSubject: tokenPayload?.sub,
        tokenAuth: tokenPayload?.auth,
        tokenIssuer: tokenPayload?.iss,
        tokenExpiry: tokenPayload?.exp ? new Date((tokenPayload.exp as number) * 1000).toISOString() : 'unknown'
      });

      // Build request body with defaults
      const requestBody = {
        filter: {
          kbNodeIds: params.kbNodeIds ?? config.knowb.defaultKbNodeIds,
          maxNumberOfResult: params.maxResults ?? config.knowb.defaultMaxResults,
          scoreThreshold: params.scoreThreshold ?? config.knowb.defaultScoreThreshold
        },
        query: params.query.trim(),
        searchType: 'auto'
      };

      const knowbUrl = `${config.knowb.upstream}/v1/search`;

      // Log the full URL and request body
      logger.info('KnowB API request details', {
        requestId,
        fullUrl: knowbUrl,
        hostname: new URL(knowbUrl).hostname,
        requestBody: JSON.stringify(requestBody)
      });

      return (await this.makeRequest(knowbUrl, requestId, 'POST', JSON.stringify(requestBody))) as BaseAPIResponse;
    });
  }

  /**
   * Upload document to knowledge base
   *
   * @param params - Upload parameters including file and metadata
   * @param requestId - Request ID for logging
   * @returns Promise resolving to API response
   */
  async upload(params: KnowBUploadParams, requestId: string = 'unknown'): Promise<KnowBAPIResponse> {
    return this.executeWithTiming(async () => {
      const jwtToken = await this.getToken();

      const tokenPayload = decodeJwtPayload(jwtToken);
      logger.info('[KnowB] SSO token obtained for upload', {
        requestId,
        tokenLength: jwtToken.length,
        tokenType: tokenPayload?.typ,
        tokenSubject: tokenPayload?.sub
      });

      const knowbUrl = `${config.knowb.upstream}/v1/kbnodes`;

      logger.info('KnowB API upload request details', {
        requestId,
        fullUrl: knowbUrl,
        hostname: new URL(knowbUrl).hostname,
        filename: params.filename,
        kbNodeId: params.kbNodeId,
        resourceType: params.resourceType
      });

      return this.makeUploadRequest(knowbUrl, jwtToken, requestId, params);
    });
  }

  /**
   * Make multipart/form-data upload request to KnowB API
   *
   * @param url - Full URL to request
   * @param jwtToken - SSO JWT token
   * @param requestId - Request ID for logging
   * @param params - Upload parameters
   * @param retries - Number of retries remaining
   * @returns Promise resolving to API response
   */
  private async makeUploadRequest(
    url: string,
    jwtToken: string,
    requestId: string,
    params: KnowBUploadParams,
    retries: number = 2
  ): Promise<KnowBAPIResponse> {
    const urlObj = new URL(url);

    const FormData = (await import('form-data')).default;
    const formData = new FormData();

    formData.append('files', params.file, {
      filename: params.filename,
      contentType: params.contentType,
      knownLength: params.file.length
    });
    formData.append('kbNodeId', params.kbNodeId);
    formData.append('resourceType', params.resourceType);

    if (params.acl !== undefined) {
      formData.append('acl', params.acl);
    }

    if (params.metadata) {
      formData.append('metadata', JSON.stringify(params.metadata));
    }

    const headers = {
      'Authorization': `sso-jwt ${jwtToken}`,
      'Accept': 'application/json',
      ...formData.getHeaders()
    };

    logger.info('[KnowB] Making upload request with form-data', {
      requestId,
      url: urlObj.pathname,
      hostname: urlObj.hostname,
      filename: params.filename,
      fileSize: params.file.length
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData.getBuffer()
      } as any);

      const data = await response.text();

      if (response.ok) {
        return {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()) as Record<string, string | string[]>,
          data: data
        };
      } else if (response.status === 401 && retries > 0) {
        logger.warn('KnowB upload returned 401, clearing SSO cache and retrying', {
          requestId,
          retriesLeft: retries
        });
        ssoClient.clearCache('sso.test-godaddy.com');

        await new Promise(resolve => setTimeout(resolve, Math.pow(2, 3 - retries) * 1000));
        return this.makeUploadRequest(url, jwtToken, requestId, params, retries - 1);
      } else {
        logger.error('[KnowB] Upload request failed', {
          requestId,
          statusCode: response.status,
          responseBody: data,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          url: urlObj.pathname,
          hostname: urlObj.hostname
        });

        const error = new Error(`KnowB upload failed with status ${response.status}`) as Error & {
          statusCode?: number;
          response?: string;
        };
        error.statusCode = response.status;
        error.response = data;
        throw error;
      }
    } catch (error) {
      logger.error('KnowB upload error', {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });

      if (retries > 0) {
        logger.info('Retrying KnowB upload', { requestId, retriesLeft: retries });
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.makeUploadRequest(url, jwtToken, requestId, params, retries - 1);
      } else {
        throw error;
      }
    }
  }
}

export default new KnowBClient();
