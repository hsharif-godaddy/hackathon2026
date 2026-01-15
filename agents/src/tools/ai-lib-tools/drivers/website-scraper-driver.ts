/**
 * Website Scraper Driver
 *
 * Handles website content scraping and screenshot capture through the web-scraper API
 * Uses SSO JWT for authentication similar to Getty implementation
 */
import { log } from '../../../logging/index.js';

import { BaseDriver } from './base-driver.js';

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Default concurrency limit for batch scraping operations
 * Controls how many pages are scraped simultaneously
 */
const DEFAULT_SCRAPE_CONCURRENCY = 5;

/**
 * Default rate limit delay between batches (in milliseconds)
 */
const DEFAULT_RATE_LIMIT_MS = 1000;

// ============================================================================
// Base Types
// ============================================================================

/**
 * Common result pattern for all scraper operations
 */
interface BaseResult {
  success: boolean;
  error?: string;
}

/**
 * Asset type classification
 */
type AssetType = 'image' | 'font' | 'icon' | 'other';

// ============================================================================
// Scrape Content Types
// ============================================================================

/**
 * Scraped page content
 */
interface ScrapedContent {
  sanitizedContent?: string;
  html?: string;
  scrapeTime?: number;
}

/**
 * Result from scraping a single page's content
 */
interface ScrapeResult extends BaseResult, ScrapedContent {}

// ============================================================================
// Screenshot Types
// ============================================================================

/**
 * Screenshot data
 */
interface ScreenshotData {
  screenshotUrl?: string;
  screenshotBase64?: string;
}

/**
 * Result from capturing a screenshot
 */
interface ScreenshotResult extends BaseResult {
  screenshotUrl?: string;
}

/**
 * Result from converting blob to base64
 */
interface Base64ConversionResult extends BaseResult {
  base64?: string;
}

// ============================================================================
// Public API Types
// ============================================================================

/**
 * Options for website scraping
 */
export interface WebsiteScraperOptions {
  url: string;
  includeAssets?: boolean;
  maxPages?: number;
}

/**
 * Combined result from scraping content and capturing screenshot
 */
export interface WebsiteScraperResult extends BaseResult, ScrapedContent, ScreenshotData {
  url?: string;
}

/**
 * Options for multi-page scraping
 */
export interface MultiPageScraperOptions {
  urls: string[];
  includeAssets?: boolean;
  rateLimit?: number;
}

/**
 * Result for a single page in multi-page scraping
 */
export interface PageScrapeResult extends BaseResult, ScrapedContent {
  url: string;
  screenshotBase64?: string;
}

/**
 * Result from scraping multiple pages
 */
export interface MultiPageScraperResult extends BaseResult {
  pages: PageScrapeResult[];
  totalPages: number;
  successfulPages: number;
  failedPages: number;
  assets?: ExtractedAsset[];
}

/**
 * Extracted asset information
 */
export interface ExtractedAsset {
  url: string;
  type: AssetType;
  altText?: string;
  context?: string;
  sourceUrl: string;
}

// ============================================================================
// Internal API Types
// ============================================================================

/**
 * API response from scrape endpoint
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
export class WebsiteScraperDriver extends BaseDriver {
  private rawSsoJwt: string;

  constructor() {
    super({
      serviceName: 'website-scraper-driver',
      defaultBaseUrl: 'https://web-scraper.api.int.test-gdcorp.tools',
      appKeyEnvVar: 'WEB_SCRAPER_APP_KEY',
      defaultAppKey: 'airo-app-builder',
    });

    // Store raw JWT for different auth formats
    this.rawSsoJwt = process.env.SSO_JWT || '';

    // Override: Web scraper doesn't support Getty proxy, always use direct SSO_JWT
    // This bypasses the BaseDriver's GETTY_TOKEN priority
    if (this.rawSsoJwt) {
      this.ssoJwt = 'sso-jwt ' + this.rawSsoJwt;
      this.useProxy = false;
      
      this.logger.info('website-scraper-driver.auth-override', {
        message: 'Using SSO_JWT for direct access (bypassing Getty proxy)',
        hasAuth: !!this.ssoJwt
      });
    } else if (!this.ssoJwt) {
      this.logger.warn('website-scraper-driver.auth-missing', {
        message: 'SSO_JWT not set - web scraper requires direct authentication'
      });
    }

    // Override base URL if WEB_SCRAPER_BASE_URL is set
    if (process.env.WEB_SCRAPER_BASE_URL) {
      this.apiBaseUrl = process.env.WEB_SCRAPER_BASE_URL;
      
      this.logger.info('website-scraper-driver.url-override', {
        baseUrl: this.apiBaseUrl
      });
    }
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

      if (!this.hasAuth()) {
        return {
          success: false,
          error: this.getAuthErrorMessage()
        };
      }

      this.logger.info('website-scraper.request.begin', {
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

      // Check if screenshot URL is already a data URI (base64) or needs conversion
      let screenshotBase64: string | undefined;
      if (screenshotResult.screenshotUrl) {
        if (screenshotResult.screenshotUrl.startsWith('data:')) {
          // Already a data URI, use it directly
          screenshotBase64 = screenshotResult.screenshotUrl;
        } else {
          // It's a blob URL, need to fetch and convert
          const base64Result = await this.convertBlobToBase64(screenshotResult.screenshotUrl);
          if (base64Result.success && base64Result.base64) {
            screenshotBase64 = base64Result.base64;
          }
        }
      }

      this.logger.info('website-scraper.request.success', {
        url,
        hasContent: !!scrapeResult.sanitizedContent,
        hasScreenshot: !!screenshotResult.screenshotUrl,
        hasBase64: !!screenshotBase64,
        isDataUri: screenshotResult.screenshotUrl?.startsWith('data:'),
        scrapeTime: scrapeResult.scrapeTime
      });

      const resultData: WebsiteScraperResult = {
        success: true,
        url
      };

      if (scrapeResult.sanitizedContent) {
        resultData.sanitizedContent = scrapeResult.sanitizedContent;
      }

      if (scrapeResult.html) {
        resultData.html = scrapeResult.html;
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
      log.error(this.logger, 'website-scraper.request.error', error as Error, {
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
  private async scrapeWebsite(url: string): Promise<ScrapeResult> {
    try {
      const queryParams = new URLSearchParams({ url });

      this.logger.info('website-scraper.scrape.request', {
        url,
        endpoint: '/v1/scrape-website'
      });

      const response = await this.get('/v1/scrape-website', queryParams);

      if (!response.ok) {
        // Check content type to avoid logging binary data
        const contentType = response.headers.get('content-type') || '';
        let errorText = '';
        
        if (contentType.includes('application/json')) {
          try {
            const errorJson = await response.json();
            errorText = JSON.stringify(errorJson);
          } catch {
            errorText = await response.text();
          }
        } else if (contentType.includes('text/')) {
          errorText = await response.text();
        } else {
          // Binary response - don't log the content
          errorText = `[Binary response: ${contentType}]`;
        }
        
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
        html: data.html, // Include raw HTML for asset extraction
        scrapeTime: data.scrapeTime
      };

    } catch (error) {
      log.error(this.logger, 'website-scraper.scrape.error', error as Error, { url });
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
   * @returns Promise resolving to base64 conversion result
   */
  private async convertBlobToBase64(blobUrl: string): Promise<Base64ConversionResult> {
    try {
      this.logger.info('website-scraper.blob-conversion.begin', { blobUrl });

      const response = await fetch(blobUrl, {
        method: 'GET',
        headers: this.getHeaders()
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

      this.logger.info('website-scraper.blob-conversion.success', {
        blobUrl,
        contentType,
        base64Length: base64.length
      });

      return {
        success: true,
        base64: dataUri
      };

    } catch (error) {
      log.error(this.logger, 'website-scraper.blob-conversion.error', error as Error, { blobUrl });
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
  private async screenshotWebsite(url: string): Promise<ScreenshotResult> {
    try {
      const queryParams = new URLSearchParams({ url });

      this.logger.info('website-scraper.screenshot.request', {
        url,
        endpoint: '/v1/screenshot-website'
      });

      // Screenshot endpoint requires Bearer token format, not sso-jwt format
      const screenshotUrl = `${this.apiBaseUrl}/v1/screenshot-website?${queryParams.toString()}`;
      const response = await fetch(screenshotUrl, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        // Check content type to avoid logging binary data
        const contentType = response.headers.get('content-type') || '';
        let errorText = '';
        
        if (contentType.includes('application/json')) {
          try {
            const errorJson = await response.json();
            errorText = JSON.stringify(errorJson);
          } catch {
            errorText = await response.text();
          }
        } else if (contentType.includes('text/')) {
          errorText = await response.text();
        } else {
          // Binary response - don't log the content
          errorText = `[Binary response: ${contentType}]`;
        }
        
        throw new Error(`Screenshot API request failed: ${response.status} ${errorText}`);
      }

      // Check if response is the image URL or the actual image
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('image/')) {
        // Response is the actual image data - convert to base64 data URI directly
        this.logger.info('website-scraper.screenshot.direct-image', {
          url,
          contentType,
          message: 'Screenshot endpoint returned image data directly'
        });
        
        // Get the image as array buffer
        const arrayBuffer = await response.arrayBuffer();
        
        // Convert to base64
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        
        // Create data URI
        const dataUri = `data:${contentType};base64,${base64}`;
        
        this.logger.info('website-scraper.screenshot.direct-conversion-success', {
          url,
          contentType,
          base64Length: base64.length
        });
        
        // Return the data URI as the screenshotUrl so it can be used directly
        return {
          success: true,
          screenshotUrl: dataUri
        };
      }
      
      // Response should be image URL as string
      const screenshotUrlResult = await response.text();

      if (!screenshotUrlResult || typeof screenshotUrlResult !== 'string' || screenshotUrlResult.trim().length === 0) {
        return {
          success: false,
          error: 'No screenshot URL returned from API'
        };
      }

      return {
        success: true,
        screenshotUrl: screenshotUrlResult.trim()
      };

    } catch (error) {
      log.error(this.logger, 'website-scraper.screenshot.error', error as Error, { url });
      return {
        success: false,
        error: `Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Scrape multiple pages with concurrency control
   * 
   * @param options - Multi-page scraping options
   * @returns Promise resolving to multi-page scrape results
   */
  async scrapeMultiplePages(options: MultiPageScraperOptions): Promise<MultiPageScraperResult> {
    const { urls, includeAssets = false, rateLimit = 1000 } = options;
    const allAssets: ExtractedAsset[] = [];
    const concurrencyLimit = DEFAULT_SCRAPE_CONCURRENCY;

    this.logger.info('website-scraper.multi-page.begin', {
      totalUrls: urls.length,
      includeAssets,
      rateLimit,
      concurrencyLimit
    });

    // Process URLs in batches with concurrency limit
    const pages: PageScrapeResult[] = [];
    
    for (let i = 0; i < urls.length; i += concurrencyLimit) {
      const batch = urls.slice(i, i + concurrencyLimit);
      
      this.logger.info('website-scraper.multi-page.batch', {
        batchNumber: Math.floor(i / concurrencyLimit) + 1,
        batchSize: batch.length,
        progress: `${i}/${urls.length}`
      });

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (url) => {
          try {
            const result = await this.scrapeAndScreenshot({ url, includeAssets });

            const pageResult: PageScrapeResult = {
              url,
              success: result.success
            };

            if (result.success) {
              pageResult.sanitizedContent = result.sanitizedContent;
              pageResult.screenshotBase64 = result.screenshotBase64;
              pageResult.html = result.html;
            } else {
              pageResult.error = result.error;
            }

            // Extract assets from raw HTML (not sanitized content which has --IMAGE-- markers)
            if (includeAssets && result.html) {
              const assets = this.extractAssets(result.html, url);
              return { pageResult, assets };
            }

            return { pageResult, assets: [] };
          } catch (error) {
            return {
              pageResult: {
                url,
                success: false,
                error: error instanceof Error ? error.message : String(error)
              },
              assets: []
            };
          }
        })
      );

      // Collect results from batch using explicit accumulation pattern
      const batchPages = batchResults
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value.pageResult);
      
      const batchAssets = batchResults
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value.assets);
      
      pages.push(...batchPages);
      allAssets.push(...batchAssets);
      
      // Log any rejected promises (shouldn't happen due to try/catch, but handle anyway)
      const batchErrors = batchResults.filter(r => r.status === 'rejected');
      if (batchErrors.length > 0) {
        batchErrors.forEach(error => {
          this.logger.error('website-scraper.multi-page.batch-error', {
            error: error.reason
          });
        });
      }

      // Add delay between batches (not between individual requests in a batch)
      if (i + concurrencyLimit < urls.length && rateLimit > 0) {
        await this.delay(rateLimit);
      }
    }

    const successfulPages = pages.filter(p => p.success).length;
    const failedPages = pages.length - successfulPages;

    this.logger.info('website-scraper.multi-page.complete', {
      totalPages: pages.length,
      successfulPages,
      failedPages,
      assetsExtracted: allAssets.length
    });

    return {
      success: successfulPages > 0,
      pages,
      totalPages: pages.length,
      successfulPages,
      failedPages,
      assets: includeAssets ? allAssets : undefined
    };
  }

  /**
   * Extract assets from HTML content
   * 
   * @param content - HTML or sanitized content
   * @param sourceUrl - Source page URL
   * @returns Array of extracted assets
   */
  private extractAssets(content: string, sourceUrl: string): ExtractedAsset[] {
    const assets: ExtractedAsset[] = [];
    const seenUrls = new Set<string>();

    // Count raw occurrences for diagnostics
    const imgTagCount = (content.match(/<img/gi) || []).length;
    const srcCount = (content.match(/src=/gi) || []).length;
    const srcsetCount = (content.match(/srcset=/gi) || []).length;
    const dataSrcCount = (content.match(/data-src=/gi) || []).length;
    
    this.logger.info('website-scraper.extract-assets-begin', {
      sourceUrl,
      contentLength: content.length,
      imgTagCount,
      srcCount,
      srcsetCount,
      dataSrcCount,
      // Sample first 500 chars to see what we're working with
      contentSample: content.substring(0, 500).replace(/\s+/g, ' ')
    });

    // Helper to add unique assets
    const addAsset = (url: string | null, type: 'image' | 'font' | 'icon' | 'other', altText?: string) => {
      if (!url || seenUrls.has(url)) return;
      if (!this.isValidAssetUrl(url)) return;
      seenUrls.add(url);
      
      this.logger.debug('website-scraper.asset-added', {
        url: url.substring(0, 150),
        type,
        hasAlt: !!altText
      });
      
      assets.push({ url, type, altText, sourceUrl });
    };

    // Extract all img tags with their attributes
    const imgTagRegex = /<img\s+([^>]*)>/gi;
    let imgMatch;
    while ((imgMatch = imgTagRegex.exec(content)) !== null) {
      const attrs = imgMatch[1] || '';
      
      // Extract alt text
      const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
      const altText = altMatch?.[1];

      // Extract src attribute
      const srcMatch = attrs.match(/(?:^|\s)src=["']([^"']+)["']/i);
      if (srcMatch?.[1]) {
        addAsset(this.resolveUrl(srcMatch[1], sourceUrl), 'image', altText);
      }

      // Extract data-src (lazy loading)
      const dataSrcMatch = attrs.match(/data-src=["']([^"']+)["']/i);
      if (dataSrcMatch?.[1]) {
        addAsset(this.resolveUrl(dataSrcMatch[1], sourceUrl), 'image', altText);
      }

      // Extract data-lazy-src
      const dataLazySrcMatch = attrs.match(/data-lazy-src=["']([^"']+)["']/i);
      if (dataLazySrcMatch?.[1]) {
        addAsset(this.resolveUrl(dataLazySrcMatch[1], sourceUrl), 'image', altText);
      }

      // Extract srcset URLs (responsive images)
      const srcsetMatch = attrs.match(/srcset=["']([^"']+)["']/i);
      if (srcsetMatch?.[1]) {
        // srcset format: "url1 1x, url2 2x" or "url1 300w, url2 600w"
        const srcsetUrls = srcsetMatch[1].split(',').map(s => s.trim().split(/\s+/)[0]);
        for (const srcsetUrl of srcsetUrls) {
          if (srcsetUrl) {
            addAsset(this.resolveUrl(srcsetUrl, sourceUrl), 'image', altText);
          }
        }
      }
    }

    // Extract background images from inline styles
    const bgImageRegex = /background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi;
    let bgMatch;
    while ((bgMatch = bgImageRegex.exec(content)) !== null) {
      if (bgMatch[1]) {
        addAsset(this.resolveUrl(bgMatch[1], sourceUrl), 'image');
      }
    }

    // Extract picture source elements
    const sourceRegex = /<source\s+[^>]*srcset=["']([^"']+)["'][^>]*>/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(content)) !== null) {
      if (sourceMatch[1]) {
        const srcsetUrls = sourceMatch[1].split(',').map(s => s.trim().split(/\s+/)[0]);
        for (const srcsetUrl of srcsetUrls) {
          if (srcsetUrl) {
            addAsset(this.resolveUrl(srcsetUrl, sourceUrl), 'image');
          }
        }
      }
    }

    // Extract fonts from link tags
    const linkRegex = /<link[^>]+href=["']([^"']+\.(?:woff2?|ttf|otf))["'][^>]*>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(content)) !== null) {
      if (linkMatch[1]) {
        addAsset(this.resolveUrl(linkMatch[1], sourceUrl), 'font');
      }
    }

    // Extract favicons and icons
    const iconRegex = /<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
    let iconMatch;
    while ((iconMatch = iconRegex.exec(content)) !== null) {
      if (iconMatch[1]) {
        addAsset(this.resolveUrl(iconMatch[1], sourceUrl), 'icon');
      }
    }

    this.logger.info('website-scraper.assets-extracted', {
      sourceUrl,
      totalAssets: assets.length,
      images: assets.filter(a => a.type === 'image').length,
      fonts: assets.filter(a => a.type === 'font').length,
      icons: assets.filter(a => a.type === 'icon').length
    });

    return assets;
  }

  /**
   * Check if a URL is a valid asset URL (not a placeholder or invalid)
   * 
   * @param url - URL to validate
   * @returns true if valid asset URL
   */
  private isValidAssetUrl(url: string): boolean {
    let reason = '';
    
    // Skip data URIs (already embedded)
    if (url.startsWith('data:')) reason = 'data URI';
    
    // Skip blob URLs
    else if (url.startsWith('blob:')) reason = 'blob URL';
    
    // Skip javascript: URLs
    else if (url.startsWith('javascript:')) reason = 'javascript URL';
    
    // Skip template placeholders (common in SSR/CSR frameworks)
    else if (url.includes('{{') || url.includes('}}')) reason = 'template placeholder {{}}';
    else if (url.includes('${')) reason = 'template placeholder ${}';
    else if (url.includes('%7B') || url.includes('%7D')) reason = 'encoded template placeholder';
    
    // Skip about: and chrome: URLs
    else if (url.startsWith('about:') || url.startsWith('chrome:')) reason = 'browser URL';
    
    // Skip empty or whitespace-only URLs
    else if (!url.trim()) reason = 'empty URL';
    
    // Skip very short URLs that are likely placeholders
    else if (url.length < 5) reason = 'too short';
    
    // Skip URLs with only hash
    else if (url === '#' || url.startsWith('#')) reason = 'hash only';
    
    if (reason) {
      this.logger.debug('website-scraper.asset-url-rejected', {
        url: url.substring(0, 100),
        reason
      });
      return false;
    }
    
    // Valid URL
    return true;
  }

  /**
   * Resolve relative URLs to absolute
   * 
   * @param url - URL to resolve
   * @param baseUrl - Base URL for resolution
   * @returns Resolved absolute URL or null
   */
  private resolveUrl(url: string, baseUrl: string): string | null {
    try {
      // Skip data URIs - they're embedded content
      if (url.startsWith('data:')) return null;
      
      // Handle Next.js image optimization URLs - extract the real image URL
      if (url.includes('/_next/image?url=')) {
        const match = url.match(/[?&]url=([^&]+)/);
        if (match && match[1]) {
          try {
            const decodedUrl = decodeURIComponent(match[1]);
            this.logger.debug('website-scraper.nextjs-image-extracted', {
              originalUrl: url.substring(0, 150),
              extractedUrl: decodedUrl
            });
            return decodedUrl;
          } catch (decodeError) {
            this.logger.warn('website-scraper.nextjs-decode-failed', {
              url: url.substring(0, 150),
              error: decodeError instanceof Error ? decodeError.message : String(decodeError)
            });
          }
        }
      }
      
      // Skip Next.js internal URLs (static chunks, build artifacts)
      if (url.includes('/_next/static/') || url.includes('/_next/data/')) {
        this.logger.debug('website-scraper.nextjs-internal-skipped', {
          url: url.substring(0, 100)
        });
        return null;
      }
      
      // Handle protocol-relative URLs
      if (url.startsWith('//')) return `https:${url}`;
      
      // Already absolute
      if (url.startsWith('http')) return url;
      
      // Resolve relative URL against base
      const base = new URL(baseUrl);
      const resolved = new URL(url, base.origin).href;
      
      return resolved;
    } catch (error) {
      this.logger.debug('website-scraper.url-resolve-failed', {
        url: url.substring(0, 100),
        baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Delay helper for rate limiting
   * 
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

