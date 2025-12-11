import https from 'https';
import { config } from '../config';
import ssoClient from '../auth/sso-client';
import logger from '../utils/logger';
import { WebScraperParams, WebScraperAPIResponse } from '../types';

/**
 * HTTPS request options interface
 */
interface HttpsRequestOptions {
  hostname: string;
  port: number | string;
  path: string;
  method: 'GET' | 'POST';
  headers: Record<string, string | number>;
  timeout: number;
}

/**
 * Web Scraper Client
 * 
 * Handles requests to the web-scraper API for content extraction and screenshots
 */
class WebScraperClient {
  /**
   * Scrape website content
   * 
   * @param params - Query parameters including URL
   * @param requestId - Request ID for logging
   * @returns Promise resolving to API response
   */
  async scrape(params: WebScraperParams, requestId: string = 'unknown'): Promise<WebScraperAPIResponse> {
    const startTime = Date.now();

    try {
      const jwtToken = await ssoClient.getToken();
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const scraperUrl = `${config.webScraper.upstream}/v1/scrape-website?${queryString}`;

      const response = await this.makeRequest(scraperUrl, jwtToken, requestId, 'GET');
      const duration = Date.now() - startTime;

      response.duration = duration;
      return response;

    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error) {
        (error as Error & { duration?: number }).duration = duration;
      }
      throw error;
    }
  }

  /**
   * Capture website screenshot
   * 
   * @param params - Query parameters including URL
   * @param requestId - Request ID for logging
   * @returns Promise resolving to API response with screenshot URL
   */
  async screenshot(params: WebScraperParams, requestId: string = 'unknown'): Promise<WebScraperAPIResponse> {
    const startTime = Date.now();

    try {
      const jwtToken = await ssoClient.getToken();
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const scraperUrl = `${config.webScraper.upstream}/v1/screenshot-website?${queryString}`;

      const response = await this.makeRequest(scraperUrl, jwtToken, requestId, 'GET');
      const duration = Date.now() - startTime;

      response.duration = duration;
      return response;

    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error) {
        (error as Error & { duration?: number }).duration = duration;
      }
      throw error;
    }
  }

  /**
   * Make HTTPS request to web-scraper API
   * 
   * @param url - Full URL to request
   * @param jwtToken - SSO JWT token
   * @param requestId - Request ID for logging
   * @param method - HTTP method
   * @param body - Optional request body
   * @param retries - Number of retries remaining
   * @returns Promise resolving to API response
   */
  private async makeRequest(
    url: string,
    jwtToken: string,
    requestId: string,
    method: 'GET' | 'POST' = 'GET',
    body?: string,
    retries: number = 2
  ): Promise<WebScraperAPIResponse> {
    return new Promise<WebScraperAPIResponse>((resolve, reject) => {
      const urlObj = new URL(url);
      
      const options: HttpsRequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          'Authorization': `sso-jwt ${jwtToken}`,
          'x-app-key': config.webScraper.appKey,
          'Accept': 'application/json',
          'User-Agent': config.webScraper.userAgent
        },
        timeout: 60000 // 60 second timeout (scraping can take longer)
      };

      if (body && method === 'POST') {
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(body);
      }

      logger.debug('Making Web Scraper API request', { 
        requestId,
        method,
        url: urlObj.pathname + urlObj.search,
        headers: this.sanitizeHeaders(options.headers)
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
            logger.warn('Web Scraper API returned 401, clearing SSO cache and retrying', { 
              requestId, 
              retriesLeft: retries 
            });
            ssoClient.clearCache();
            
            // Retry with exponential backoff
            setTimeout(() => {
              this.makeRequest(url, jwtToken, requestId, method, body, retries - 1)
                .then(resolve)
                .catch(reject);
            }, Math.pow(2, 3 - retries) * 1000);
          } else {
            const error = new Error(`Web Scraper API request failed with status ${response.statusCode}`) as Error & {
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
        logger.error('Web Scraper API request error', { requestId, error: error.message });
        
        if (retries > 0) {
          logger.info('Retrying Web Scraper API request', { requestId, retriesLeft: retries });
          setTimeout(() => {
            this.makeRequest(url, jwtToken, requestId, method, body, retries - 1)
              .then(resolve)
              .catch(reject);
          }, 1000);
        } else {
          reject(error);
        }
      });

      request.on('timeout', () => {
        logger.error('Web Scraper API request timed out', { requestId });
        request.destroy();
        reject(new Error('Web Scraper API request timed out'));
      });

      if (body && method === 'POST') {
        request.write(body);
      }

      request.end();
    });
  }

  /**
   * Sanitize headers for logging
   * 
   * @param headers - Request headers
   * @returns Sanitized headers with sensitive data redacted
   */
  private sanitizeHeaders(headers: Record<string, string | number>): Record<string, string> {
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

export default new WebScraperClient();
