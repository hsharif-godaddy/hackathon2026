import https from 'https';
import { config } from '../config';
import ssoClient from '../auth/sso-client';
import logger from '../utils/logger';
import { GettySearchParams, GettyAPIResponse } from '../types';

class GettyClient {
  async search(params: GettySearchParams, requestId: string = 'unknown'): Promise<GettyAPIResponse> {
    const startTime = Date.now();

    try {
      // Get SSO JWT token
      const jwtToken = await ssoClient.getToken();

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

  private async _makeRequest(url: string, jwtToken: string, requestId: string, retries: number = 2): Promise<GettyAPIResponse> {
    return new Promise<GettyAPIResponse>((resolve, reject) => {
      const urlObj = new URL(url);
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'Authorization': `sso-jwt ${jwtToken}`,
          'x-app-key': config.getty.appKey,
          'Accept': 'application/json',
          'User-Agent': config.getty.userAgent
        },
        timeout: 30000 // 30 second timeout
      };

      logger.debug('Making Getty API request', { 
        requestId, 
        url: urlObj.pathname + urlObj.search,
        headers: this._sanitizeHeaders(options.headers)
      });

      const request = https.request(options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              statusCode: response.statusCode,
              headers: response.headers as Record<string, string | string[]>,
              data: data
            });
          } else if (response.statusCode === 401 && retries > 0) {
            // Token might be expired, clear cache and retry
            logger.warn('Getty API returned 401, clearing SSO cache and retrying', { 
              requestId, 
              retriesLeft: retries 
            });
            ssoClient.clearCache();
            
            // Retry with exponential backoff
            setTimeout(() => {
              this._makeRequest(url, jwtToken, requestId, retries - 1)
                .then(resolve)
                .catch(reject);
            }, Math.pow(2, 3 - retries) * 1000);
          } else {
            const error = new Error(`Getty API request failed with status ${response.statusCode}`) as Error & {
              statusCode?: number;
              response?: string;
            };
            if (response.statusCode !== undefined) {
              error.statusCode = response.statusCode;
            }
            error.response = data;
            reject(error);
          }
        });
      });

      request.on('error', (error) => {
        logger.error('Getty API request error', { requestId, error: error.message });
        
        if (retries > 0) {
          logger.info('Retrying Getty API request', { requestId, retriesLeft: retries });
          setTimeout(() => {
            this._makeRequest(url, jwtToken, requestId, retries - 1)
              .then(resolve)
              .catch(reject);
          }, 1000);
        } else {
          reject(error);
        }
      });

      request.on('timeout', () => {
        logger.error('Getty API request timed out', { requestId });
        request.destroy();
        reject(new Error('Getty API request timed out'));
      });

      request.end();
    });
  }

  private _sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    // Remove sensitive data from logs
    const sanitized = { ...headers };
    if (sanitized.Authorization) {
      sanitized.Authorization = sanitized.Authorization.substring(0, 20) + '...';
    }
    return sanitized;
  }
}

export default new GettyClient();
