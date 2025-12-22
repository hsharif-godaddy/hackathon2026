import { config } from '../config';
import { BaseClient } from './base-client';
import { WebScraperParams, WebScraperAPIResponse } from '../types';

/**
 * Web Scraper Client
 * 
 * Handles requests to the web-scraper API for content extraction and screenshots
 */
class WebScraperClient extends BaseClient {
  constructor() {
    super({
      serviceName: 'WebScraper',
      ssoHost: config.sso.host,
      defaultRetries: 2,
    });
  }
  /**
   * Scrape website content
   * 
   * @param params - Query parameters including URL
   * @param requestId - Request ID for logging
   * @returns Promise resolving to API response
   */
  async scrape(params: WebScraperParams, requestId: string = 'unknown'): Promise<WebScraperAPIResponse> {
    return this.executeWithTiming(async () => {
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const scraperUrl = `${config.webScraper.upstream}/v1/scrape-website?${queryString}`;

      return this.makeRequest(scraperUrl, requestId, 'GET', undefined, {
        'x-app-key': config.webScraper.appKey,
        'User-Agent': config.webScraper.userAgent,
      });
    });
  }

  /**
   * Capture website screenshot
   * 
   * @param params - Query parameters including URL
   * @param requestId - Request ID for logging
   * @returns Promise resolving to API response with screenshot URL
   */
  async screenshot(params: WebScraperParams, requestId: string = 'unknown'): Promise<WebScraperAPIResponse> {
    return this.executeWithTiming(async () => {
      const queryString = new URLSearchParams(params as Record<string, string>).toString();
      const scraperUrl = `${config.webScraper.upstream}/v1/screenshot-website?${queryString}`;

      return this.makeRequest(scraperUrl, requestId, 'GET', undefined, {
        'x-app-key': config.webScraper.appKey,
        'User-Agent': config.webScraper.userAgent,
      });
    });
  }

}

export default new WebScraperClient();
