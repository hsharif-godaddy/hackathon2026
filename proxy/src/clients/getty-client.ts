import { config } from '../config';
import ssoClient from '../auth/sso-client';
import logger from '../utils/logger';
import { GettySearchParams, GettyAPIResponse } from '../types';

class GettyClient {
  async search(params: GettySearchParams, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    const startTime = Date.now();

    try {
      // Get SSO JWT token - Getty uses production SSO (godaddy.com)
      const jwtToken = await ssoClient.getToken('sso.godaddy.com');

      // Build Getty API URL
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const gettyUrl = `${config.getty.upstream}/v1/search?${queryString}`;

      const response = await this._makeRequest(gettyUrl, jwtToken, requestId);

      const duration = Date.now() - startTime;

      // Add timing info to response
      response.duration = duration;
      return response;

    } catch (error) {
      const duration = Date.now() - startTime;

      // Add error info for consolidated logging
      if (error instanceof Error) {
        (error as Error & { duration?: number }).duration = duration;
      }
      throw error;
    }
  }

  async videoSearch(params: GettySearchParams, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    const startTime = Date.now();

    try {
      // Get SSO JWT token - Getty uses production SSO (godaddy.com)
      const jwtToken = await ssoClient.getToken('sso.godaddy.com');

      // Build Getty Video API URL
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const gettyUrl = `${config.getty.upstream}/v1/videos/search?${queryString}`;

      const response = await this._makeRequest(gettyUrl, jwtToken, requestId, 'GET');

      const duration = Date.now() - startTime;

      // Add timing info to response
      response.duration = duration;
      return response;

    } catch (error) {
      const duration = Date.now() - startTime;

      // Add error info for consolidated logging
      if (error instanceof Error) {
        (error as Error & { duration?: number }).duration = duration;
      }
      throw error;
    }
  }

  async videoUpload(videoId: string, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    const startTime = Date.now();

    try {
      // Get SSO JWT token - Getty uses production SSO (godaddy.com)
      const jwtToken = await ssoClient.getToken('sso.godaddy.com');

      // Build Getty Video Upload API URL
      const gettyUrl = `${config.getty.upstream}/v1/videos/upload`;

      const response = await this._makeRequest(gettyUrl, jwtToken, requestId, 'POST', JSON.stringify({ id: videoId }));

      const duration = Date.now() - startTime;

      // Add timing info to response
      response.duration = duration;
      return response;

    } catch (error) {
      const duration = Date.now() - startTime;

      // Add error info for consolidated logging
      if (error instanceof Error) {
        (error as Error & { duration?: number }).duration = duration;
      }
      throw error;
    }
  }

  private async _makeRequest(url: string, jwtToken: string, requestId: string, method: 'GET' | 'POST' = 'GET', body?: string, retries: number = 2): Promise<GettyAPIResponse> {
    const urlObj = new URL(url);

    const headers: Record<string, string> = {
      'Authorization': `sso-jwt ${jwtToken}`,
      'x-app-key': config.getty.appKey,
      'Accept': 'application/json',
      'User-Agent': config.getty.userAgent
    };

    if (body && method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }

    logger.debug('Making Getty API request with fetch', {
      requestId,
      method,
      url: urlObj.pathname + urlObj.search,
      headers: this._sanitizeHeaders(headers)
    });

    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(body && method === 'POST' && { body })
      });

      const data = await response.text();

      if (response.ok) {
        return {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()) as Record<string, string | string[]>,
          data: data
        };
      } else if (response.status === 401 && retries > 0) {
        // Token might be expired, clear cache and retry
        logger.warn('Getty API returned 401, clearing SSO cache and retrying', {
          requestId,
          retriesLeft: retries
        });
        ssoClient.clearCache('sso.godaddy.com');

        // Retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, 3 - retries) * 1000));
        return this._makeRequest(url, jwtToken, requestId, method, body, retries - 1);
      } else {
        const error = new Error(`Getty API request failed with status ${response.status}`) as Error & {
          statusCode?: number;
          response?: string;
        };
        error.statusCode = response.status;
        error.response = data;
        throw error;
      }
    } catch (error) {
      logger.error('Getty API request error', {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });

      if (retries > 0) {
        logger.info('Retrying Getty API request', { requestId, retriesLeft: retries });
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this._makeRequest(url, jwtToken, requestId, method, body, retries - 1);
      } else {
        throw error;
      }
    }
  }

  private _sanitizeHeaders(headers: Record<string, string | number>): Record<string, string> {
    // Remove sensitive data from logs and convert to strings
    const sanitized: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(headers)) {
      if (key === 'Authorization') {
        sanitized[key] = String(value).substring(0, 20) + '...';
      } else {
        sanitized[key] = String(value);
      }
    }
    
    return sanitized;
  }
}

export default new GettyClient();
