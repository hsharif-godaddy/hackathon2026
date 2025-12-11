/**
 * Website Scraper Driver
 * 
 * Handles website content scraping and screenshot capture through the web-scraper API
 * Uses SSO JWT for authentication similar to Getty implementation
 */
import { Logger, log } from '../../../logging/index.js';

const logger = Logger.create({ service: 'website-scraper-driver' });

/**
 * Options for website scraping
 */
export interface WebsiteScraperOptions {
  url: string;
}

/**
 * Website scraper result containing both content and screenshot
 */
export interface WebsiteScraperResult {
  success: boolean;
  url?: string;
  sanitizedContent?: string;
  screenshotUrl?: string;
  screenshotBase64?: string;
  scrapeTime?: number;
  error?: string;
}

/**
 * API response for scrape endpoint
 */
interface ScrapeAPIResponse {
  url: string;
  html: string;
  sanitizedContent: string;
  scrapeTime: number;
  statusCode: number;
  error?: string;
}

/**
 * Website Scraper Driver
 * Handles website content extraction and screenshot capture with shared infrastructure
 */
export class WebsiteScraperDriver {
  private apiBaseUrl: string;
  private appKey: string;
  private ssoJwt: string;

  constructor() {
    // Use GETTY_API_URL (shared proxy URL) or fallback to direct API
    // In hosted env: GETTY_API_URL points to proxy (e.g., https://...onkatana.net/img/search)
    // In local dev: Can point directly to web-scraper API
    const baseUrl = process.env.GETTY_API_URL || 'https://web-scraper.api.int.test-gdcorp.tools';
    
    // Strip any path components to get clean base URL
    // Getty URL may include paths like /img/search which need to be removed
    try {
      const urlObj = new URL(baseUrl);
      this.apiBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch (error) {
      // If URL parsing fails, strip common path patterns
      this.apiBaseUrl = baseUrl.replace(/\/(img\/search|v1\/).*$/, '');
    }
    
    this.appKey = process.env.WEB_SCRAPER_APP_KEY || 'airo-app-builder';

    if (process.env.GETTY_TOKEN) {
      this.ssoJwt = 'Bearer ' + process.env.GETTY_TOKEN;
    } else if (process.env.SSO_JWT) {
      this.ssoJwt = 'sso-jwt ' + process.env.SSO_JWT;
    } else {
      this.ssoJwt = '';
    }

    if (!this.ssoJwt) {
      logger.warn('website-scraper.auth.missing', {
        message: 'Neither GETTY_TOKEN nor SSO_JWT is set',
      });
    }
    
    // Log the configured base URL for debugging
    logger.info('website-scraper.config.initialized', {
      configuredUrl: baseUrl,
      cleanedBaseUrl: this.apiBaseUrl,
      hasToken: !!this.ssoJwt,
      usingProxyUrl: baseUrl.includes('onkatana.net')
    });
  }

  /**
   * Scrape website and capture screenshot in parallel
   * 
   * @param options - Scraping options containing the target URL
   * @returns Promise resolving to combined scrape and screenshot results
   */
  async scrapeAndScreenshot(options: WebsiteScraperOptions): Promise<WebsiteScraperResult> {
    try {
      const { url } = options;

      if (!url || typeof url !== 'string' || url.trim().length === 0) {
        return {
          success: false,
          error: 'A valid URL is required'
        };
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        return {
          success: false,
          error: 'Invalid URL format provided'
        };
      }

      if (!this.ssoJwt) {
        return {
          success: false,
          error: 'SSO JWT token is not configured. Please add it to your .env file.'
        };
      }

      logger.info('website-scraper.request.begin', {
        url,
        baseUrl: this.apiBaseUrl
      });

      // Make both requests in parallel using Promise.all
      const [scrapeResult, screenshotResult] = await Promise.all([
        this.scrapeWebsite(url),
        this.screenshotWebsite(url)
      ]);

      // Check if both requests succeeded
      if (!scrapeResult.success) {
        return {
          success: false,
          error: scrapeResult.error || 'Failed to scrape website content'
        };
      }

      if (!screenshotResult.success) {
        return {
          success: false,
          error: screenshotResult.error || 'Failed to capture website screenshot'
        };
      }

      // Convert blob URL to base64 if screenshot was captured
      let screenshotBase64: string | undefined;
      if (screenshotResult.screenshotUrl) {
        const base64Result = await this.convertBlobToBase64(screenshotResult.screenshotUrl);
        if (base64Result.success && base64Result.base64) {
          screenshotBase64 = base64Result.base64;
        }
      }

      logger.info('website-scraper.request.success', {
        url,
        hasContent: !!scrapeResult.sanitizedContent,
        hasScreenshot: !!screenshotResult.screenshotUrl,
        hasBase64: !!screenshotBase64,
        scrapeTime: scrapeResult.scrapeTime
      });

      const resultData: WebsiteScraperResult = {
        success: true,
        url
      };

      if (scrapeResult.sanitizedContent) {
        resultData.sanitizedContent = scrapeResult.sanitizedContent;
      }

      if (screenshotResult.screenshotUrl) {
        resultData.screenshotUrl = screenshotResult.screenshotUrl;
      }

      if (screenshotBase64) {
        resultData.screenshotBase64 = screenshotBase64;
      }

      if (scrapeResult.scrapeTime) {
        resultData.scrapeTime = scrapeResult.scrapeTime;
      }

      return resultData;

    } catch (error) {
      log.error(logger, 'website-scraper.request.error', error as Error, {
        url: options.url
      });
      
      return {
        success: false,
        error: `Website scraping failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Scrape website content
   * 
   * @param url - Target website URL
   * @returns Promise resolving to scrape result
   */
  private async scrapeWebsite(url: string): Promise<{ success: boolean; sanitizedContent?: string; scrapeTime?: number; error?: string }> {
    try {
      const queryParams = new URLSearchParams({ url });
      const endpoint = '/v1/scrape-website';
      const fullUrl = `${this.apiBaseUrl}${endpoint}?${queryParams.toString()}`;

      logger.info('website-scraper.scrape.request', {
        url,
        endpoint: fullUrl
      });

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.ssoJwt,
          'x-app-key': this.appKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Scrape API request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as ScrapeAPIResponse;

      if (!data || !data.sanitizedContent) {
        return {
          success: false,
          error: 'No content extracted from website'
        };
      }

      return {
        success: true,
        sanitizedContent: data.sanitizedContent,
        scrapeTime: data.scrapeTime
      };

    } catch (error) {
      log.error(logger, 'website-scraper.scrape.error', error as Error, { url });
      return {
        success: false,
        error: `Content scraping failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Convert blob URL to base64
   * 
   * @param blobUrl - Blob URL to convert
   * @returns Promise resolving to base64 string
   */
  private async convertBlobToBase64(blobUrl: string): Promise<{ success: boolean; base64?: string; error?: string }> {
    try {
      logger.info('website-scraper.blob-conversion.begin', { blobUrl });

      const response = await fetch(blobUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.ssoJwt,
          'x-app-key': this.appKey
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`);
      }

      // Get the image as array buffer
      const arrayBuffer = await response.arrayBuffer();
      
      // Convert to base64
      const buffer = Buffer.from(arrayBuffer);
      const base64 = buffer.toString('base64');
      
      // Get content type from response headers, default to png
      const contentType = response.headers.get('content-type') || 'image/png';
      
      // Create data URI
      const dataUri = `data:${contentType};base64,${base64}`;

      logger.info('website-scraper.blob-conversion.success', {
        blobUrl,
        contentType,
        base64Length: base64.length
      });

      return {
        success: true,
        base64: dataUri
      };

    } catch (error) {
      log.error(logger, 'website-scraper.blob-conversion.error', error as Error, { blobUrl });
      return {
        success: false,
        error: `Blob conversion failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Capture website screenshot
   * 
   * @param url - Target website URL
   * @returns Promise resolving to screenshot result
   */
  private async screenshotWebsite(url: string): Promise<{ success: boolean; screenshotUrl?: string; error?: string }> {
    try {
      const queryParams = new URLSearchParams({ url });
      const endpoint = '/v1/screenshot-website';
      const fullUrl = `${this.apiBaseUrl}${endpoint}?${queryParams.toString()}`;

      logger.info('website-scraper.screenshot.request', {
        url,
        endpoint: fullUrl
      });

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Authorization': this.ssoJwt,
          'x-app-key': this.appKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Screenshot API request failed: ${response.status} ${errorText}`);
      }

      // Response is image URL as string
      const screenshotUrl = await response.text();

      if (!screenshotUrl || typeof screenshotUrl !== 'string' || screenshotUrl.trim().length === 0) {
        return {
          success: false,
          error: 'No screenshot URL returned from API'
        };
      }

      return {
        success: true,
        screenshotUrl: screenshotUrl.trim()
      };

    } catch (error) {
      log.error(logger, 'website-scraper.screenshot.error', error as Error, { url });
      return {
        success: false,
        error: `Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

