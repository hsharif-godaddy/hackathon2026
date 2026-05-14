import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'sitemap-discovery-service' });

/**
 * Discovered page information
 */
export interface DiscoveredPage {
  url: string;
  priority?: number;
  changefreq?: string;
  lastmod?: string;
  source: 'sitemap' | 'robots' | 'crawl';
  isBlog?: boolean;
}

/**
 * Sitemap discovery result
 */
export interface SitemapDiscoveryResult {
  success: boolean;
  pages: DiscoveredPage[];
  totalPages: number;
  error?: string;
}

/**
 * Sitemap Discovery Service
 * 
 * Discovers all pages on a website through multiple methods:
 * 1. Parse robots.txt for sitemap locations
 * 2. Parse sitemap.xml files (including sitemap indexes)
 * 3. Fallback to crawling homepage for internal links
 */
export class SitemapDiscoveryService {
  private maxPages: number;
  private baseUrl: string;

  constructor(baseUrl: string, maxPages: number = 20) {
    this.baseUrl = baseUrl;
    this.maxPages = maxPages;
  }

  /**
   * Check if URL has a path beyond the root
   *
   * @param url - URL to check
   * @returns True if URL has path segments beyond /
   */
  static hasPathBeyondRoot(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.replace(/\/$/, '');
      return path.length > 0 && path !== '/';
    } catch {
      return false;
    }
  }

  /**
   * Extract the path prefix from a URL
   *
   * @param url - URL to extract path from
   * @returns Path prefix (e.g., "/psycholand" from "https://example.com/psycholand")
   */
  static extractPathPrefix(url: string): string {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.replace(/\/$/, '');
      return path || '/';
    } catch {
      return '/';
    }
  }

  /**
   * Discover all pages on the website
   * 
   * @returns Promise resolving to discovery result
   */
  async discover(): Promise<SitemapDiscoveryResult> {
    try {
      logger.info('sitemap-discovery.begin', {
        baseUrl: this.baseUrl,
        maxPages: this.maxPages
      });

      let pages: DiscoveredPage[] = [];
      let sitemapUrls: string[] = [];

      // First, determine the canonical base URL (after redirects)
      const canonicalBaseUrl = await this.getCanonicalBaseUrl();

      logger.info('sitemap-discovery.canonical-url', {
        originalUrl: this.baseUrl,
        canonicalUrl: canonicalBaseUrl,
        redirected: canonicalBaseUrl !== this.baseUrl
      });

      // Try the common /sitemap.xml location on the canonical URL
      const defaultSitemapUrl = new URL('/sitemap.xml', canonicalBaseUrl).href;
      const hasDefaultSitemap = await this.checkSitemapExists(defaultSitemapUrl);

      if (hasDefaultSitemap) {
        logger.info('sitemap-discovery.default-sitemap-found', {
          url: defaultSitemapUrl
        });
        sitemapUrls.push(defaultSitemapUrl);
      } else {
        // If no /sitemap.xml, check robots.txt on canonical URL
        const robotsUrl = new URL('/robots.txt', canonicalBaseUrl).href;
        sitemapUrls = await this.findSitemapsFromRobots(robotsUrl);
      }

      if (sitemapUrls.length > 0) {
        logger.info('sitemap-discovery.sitemaps-found', {
          count: sitemapUrls.length,
          urls: sitemapUrls
        });

        for (const sitemapUrl of sitemapUrls) {
          const sitemapPages = await this.parseSitemap(sitemapUrl);
          pages.push(...sitemapPages);

          if (pages.length >= this.maxPages) break;
        }
      }

      // Always crawl homepage to get linked pages for priority boosting
      // Even if we found a sitemap, homepage links are important
      logger.info('sitemap-discovery.crawl-homepage-links', {
        message: 'Crawling homepage to identify priority pages'
      });

      const crawledPages = await this.crawlHomepage();
      
      if (pages.length === 0) {
        // If no sitemap pages, use crawled pages as the main source
        pages.push(...crawledPages);
      } else {
        // Boost priority of pages that are linked from homepage
        const homepageLinkedUrls = new Set(crawledPages.map(p => this.normalizeUrl(p.url)));
        
        logger.info('sitemap-discovery.homepage-links-found', {
          count: homepageLinkedUrls.size
        });

        // Boost priority for pages linked from homepage
        pages = pages.map(page => {
          const normalizedUrl = this.normalizeUrl(page.url);
          if (homepageLinkedUrls.has(normalizedUrl)) {
            return {
              ...page,
              priority: Math.max(page.priority || 0.5, 0.8) // Boost to at least 0.8
            };
          }
          return page;
        });
      }

      const pagesWithSourceUrl: DiscoveredPage[] = [
        { url: canonicalBaseUrl, priority: 1.0, source: 'crawl' },
        ...pages
      ];

      const uniquePages = this.deduplicatePages(pagesWithSourceUrl).slice(0, this.maxPages);
      const pagesWithBlogDetection = this.detectBlogPages(uniquePages);

      logger.info('sitemap-discovery.complete', {
        totalPages: pagesWithBlogDetection.length,
        blogPages: pagesWithBlogDetection.filter(p => p.isBlog).length,
        sources: this.countSources(pagesWithBlogDetection)
      });

      return {
        success: true,
        pages: pagesWithBlogDetection,
        totalPages: pagesWithBlogDetection.length
      };
    } catch (error) {
      logger.error('sitemap-discovery.error', {
        error: error instanceof Error ? error.message : String(error),
        baseUrl: this.baseUrl
      });

      return {
        success: false,
        pages: [],
        totalPages: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Crawl from a specific path, only following links within the path prefix
   *
   * @param pathPrefix - The path prefix to stay within (e.g., "/psycholand")
   * @returns Promise resolving to discovery result
   */
  async crawlFromPath(pathPrefix: string): Promise<SitemapDiscoveryResult> {
    try {
      logger.info('sitemap-discovery.crawl-from-path.begin', {
        baseUrl: this.baseUrl,
        pathPrefix,
        maxPages: this.maxPages
      });

      const pages: DiscoveredPage[] = [];
      const visited = new Set<string>();
      const queued = new Set<string>(); // Track URLs already in queue to prevent duplicates
      const queue: string[] = [this.baseUrl];
      queued.add(this.normalizeUrl(this.baseUrl));

      while (queue.length > 0 && pages.length < this.maxPages) {
        const currentUrl = queue.shift();
        if (!currentUrl) continue;

        const normalizedUrl = this.normalizeUrl(currentUrl);
        if (visited.has(normalizedUrl)) continue;
        visited.add(normalizedUrl);

        // Fetch and parse the page
        const links = await this.extractLinksFromPage(currentUrl);

        // Add current page to results
        pages.push({
          url: currentUrl,
          priority: currentUrl === this.baseUrl ? 1.0 : 0.5,
          source: 'crawl'
        });

        // Queue links that match the path prefix
        for (const link of links) {
          const normalizedLink = this.normalizeUrl(link);
          if (
            this.matchesPathPrefix(link, pathPrefix) &&
            !visited.has(normalizedLink) &&
            !queued.has(normalizedLink)
          ) {
            queue.push(link);
            queued.add(normalizedLink);
          }
        }
      }

      const pagesWithBlogDetection = this.detectBlogPages(pages);

      logger.info('sitemap-discovery.crawl-from-path.complete', {
        baseUrl: this.baseUrl,
        pathPrefix,
        totalPages: pagesWithBlogDetection.length
      });

      return {
        success: true,
        pages: pagesWithBlogDetection,
        totalPages: pagesWithBlogDetection.length
      };
    } catch (error) {
      logger.error('sitemap-discovery.crawl-from-path.error', {
        error: error instanceof Error ? error.message : String(error),
        baseUrl: this.baseUrl,
        pathPrefix
      });

      return {
        success: false,
        pages: [],
        totalPages: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get the canonical base URL after following redirects
   *
   * @returns Promise resolving to the final URL after redirects
   */
  private async getCanonicalBaseUrl(): Promise<string> {
    try {
      logger.info('sitemap-discovery.canonical-check', { baseUrl: this.baseUrl });

      const response = await fetch(this.baseUrl, { method: 'HEAD' });
      const finalUrl = response.url || this.baseUrl;

      logger.info('sitemap-discovery.canonical-resolved', {
        originalUrl: this.baseUrl,
        finalUrl: finalUrl
      });

      return finalUrl;
    } catch (error) {
      logger.warn('sitemap-discovery.canonical-error', {
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      // Fallback to original URL if HEAD request fails
      return this.baseUrl;
    }
  }

  /**
   * Check if a sitemap exists at the given URL
   * 
   * @param sitemapUrl - URL to check
   * @returns Promise resolving to true if sitemap exists
   */
  private async checkSitemapExists(sitemapUrl: string): Promise<boolean> {
    try {
      logger.info('sitemap-discovery.check-default', { sitemapUrl });

      const response = await fetch(sitemapUrl, { method: 'HEAD' });

      if (response.ok) {
        logger.info('sitemap-discovery.default-exists', { sitemapUrl });
        return true;
      }

      logger.info('sitemap-discovery.default-not-found', {
        sitemapUrl,
        status: response.status
      });
      return false;
    } catch (error) {
      logger.warn('sitemap-discovery.default-check-error', {
        sitemapUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Find sitemap URLs from robots.txt
   * 
   * @param robotsUrl - Optional robots.txt URL (defaults to baseUrl/robots.txt)
   * @returns Promise resolving to array of sitemap URLs
   */
  private async findSitemapsFromRobots(robotsUrl?: string): Promise<string[]> {
    try {
      const finalRobotsUrl = robotsUrl || new URL('/robots.txt', this.baseUrl).href;
      logger.info('sitemap-discovery.robots.fetch', { robotsUrl: finalRobotsUrl });

      const response = await fetch(finalRobotsUrl);

      if (!response.ok) {
        logger.warn('sitemap-discovery.robots.not-found', {
          status: response.status
        });
        return [];
      }

      const robotsText = await response.text();
      const sitemapRegex = /Sitemap:\s*(.+)/gi;
      const sitemaps: string[] = [];
      let match;

      while ((match = sitemapRegex.exec(robotsText)) !== null) {
        if (match[1]) {
          sitemaps.push(match[1].trim());
        }
      }

      return sitemaps;
    } catch (error) {
      logger.warn('sitemap-discovery.robots.error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Parse sitemap XML file
   * 
   * @param sitemapUrl - URL of the sitemap
   * @returns Promise resolving to array of discovered pages
   */
  private async parseSitemap(sitemapUrl: string): Promise<DiscoveredPage[]> {
    try {
      logger.info('sitemap-discovery.sitemap.fetch', { sitemapUrl });

      const response = await fetch(sitemapUrl);

      if (!response.ok) {
        logger.warn('sitemap-discovery.sitemap.not-found', {
          sitemapUrl,
          status: response.status
        });
        return [];
      }

      const xmlText = await response.text();
      
      if (xmlText.includes('<sitemapindex')) {
        return await this.parseSitemapIndex(xmlText);
      }

      if (xmlText.includes('<urlset')) {
        return this.parseUrlSet(xmlText);
      }

      logger.warn('sitemap-discovery.sitemap.invalid-format', {
        sitemapUrl
      });
      return [];
    } catch (error) {
      logger.warn('sitemap-discovery.sitemap.error', {
        sitemapUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Parse sitemap index (contains multiple sitemaps)
   * 
   * @param xmlText - XML text of sitemap index
   * @returns Promise resolving to array of discovered pages
   */
  private async parseSitemapIndex(xmlText: string): Promise<DiscoveredPage[]> {
    const pages: DiscoveredPage[] = [];
    
    const locMatches = xmlText.matchAll(/<loc>(.*?)<\/loc>/g);
    
    for (const match of locMatches) {
      const sitemapUrl = match[1];
      if (sitemapUrl) {
        const sitemapPages = await this.parseSitemap(sitemapUrl);
        pages.push(...sitemapPages);
        
        if (pages.length >= this.maxPages) break;
      }
    }

    return pages;
  }

  /**
   * Parse URL set from sitemap
   * 
   * @param xmlText - XML text of sitemap
   * @returns Array of discovered pages
   */
  private parseUrlSet(xmlText: string): DiscoveredPage[] {
    const pages: DiscoveredPage[] = [];
    
    const urlMatches = xmlText.matchAll(/<url>(.*?)<\/url>/gs);
    
    for (const urlMatch of urlMatches) {
      const urlBlock = urlMatch[1];
      if (!urlBlock) continue;
      
      const locMatch = urlBlock.match(/<loc>(.*?)<\/loc>/);
      if (!locMatch || !locMatch[1]) continue;
      
      const page: DiscoveredPage = {
        url: locMatch[1],
        source: 'sitemap'
      };
      
      const priorityMatch = urlBlock.match(/<priority>(.*?)<\/priority>/);
      if (priorityMatch && priorityMatch[1]) {
        page.priority = parseFloat(priorityMatch[1]);
      }
      
      const changefreqMatch = urlBlock.match(/<changefreq>(.*?)<\/changefreq>/);
      if (changefreqMatch && changefreqMatch[1]) {
        page.changefreq = changefreqMatch[1];
      }
      
      const lastmodMatch = urlBlock.match(/<lastmod>(.*?)<\/lastmod>/);
      if (lastmodMatch && lastmodMatch[1]) {
        page.lastmod = lastmodMatch[1];
      }
      
      pages.push(page);
      
      if (pages.length >= this.maxPages) break;
    }

    return pages;
  }

  /**
   * Crawl homepage for internal links as fallback
   * 
   * @returns Promise resolving to array of discovered pages
   */
  private async crawlHomepage(): Promise<DiscoveredPage[]> {
    try {
      logger.info('sitemap-discovery.crawl.begin', { baseUrl: this.baseUrl });

      const response = await fetch(this.baseUrl);

      if (!response.ok) {
        logger.warn('sitemap-discovery.crawl.failed', {
          status: response.status
        });
        return [];
      }

      // Use the final URL after redirects for hostname comparison
      const finalUrl = response.url || this.baseUrl;
      const finalUrlObj = new URL(finalUrl);

      logger.info('sitemap-discovery.crawl.redirect-check', {
        originalUrl: this.baseUrl,
        finalUrl: finalUrl,
        redirected: finalUrl !== this.baseUrl
      });

      const html = await response.text();
      const pages: DiscoveredPage[] = [];
      const visitedUrls = new Set<string>();

      // Add the final homepage URL (after redirects)
      pages.push({
        url: finalUrl,
        priority: 1.0,
        source: 'crawl'
      });
      visitedUrls.add(finalUrl);

      // Fixed regex: \s* allows zero or more spaces, making href immediately after <a valid
      const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
      let match;

      logger.debug('sitemap-discovery.crawl.parsing-links', {
        htmlLength: html.length,
        finalUrl: finalUrl,
        hostname: finalUrlObj.hostname
      });

      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        if (!href) continue;

        try {
          // Resolve relative URLs against the final URL (after redirects)
          const url = new URL(href, finalUrl);

          // Only include same-hostname URLs, no hash fragments, and not already visited
          if (url.hostname === finalUrlObj.hostname && !url.hash && !visitedUrls.has(url.href)) {
            pages.push({
              url: url.href,
              source: 'crawl',
              priority: 0.5
            });
            visitedUrls.add(url.href);

            logger.debug('sitemap-discovery.crawl.link-found', {
              href,
              resolvedUrl: url.href
            });
          }
        } catch {
          // Ignore malformed URLs
          continue;
        }

        if (pages.length >= this.maxPages) break;
      }

      logger.info('sitemap-discovery.crawl.complete', {
        pagesFound: pages.length,
        uniqueUrls: visitedUrls.size
      });

      return pages;
    } catch (error) {
      logger.warn('sitemap-discovery.crawl.error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Remove duplicate pages
   * 
   * @param pages - Array of pages
   * @returns Deduplicated array
   */
  private deduplicatePages(pages: DiscoveredPage[]): DiscoveredPage[] {
    const seen = new Set<string>();
    const unique: DiscoveredPage[] = [];

    for (const page of pages) {
      const normalizedUrl = this.normalizeUrl(page.url);

      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        unique.push(page);
      }
    }

    return unique.sort((a, b) => {
      const priorityA = a.priority || 0.5;
      const priorityB = b.priority || 0.5;
      return priorityB - priorityA;
    });
  }

  /**
   * Normalize URL for comparison
   * 
   * @param url - URL to normalize
   * @returns Normalized URL string
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';
      urlObj.search = '';
      if (urlObj.pathname.endsWith('/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      return urlObj.href;
    } catch {
      return url;
    }
  }

  /**
   * Detect and mark blog/article pages based on URL patterns
   * 
   * Strategy: If 5+ pages share a common path prefix with blog-related keywords
   * or date patterns, mark them all as blog posts.
   * 
   * @param pages - Array of pages to analyze
   * @returns Pages with isBlog flag set
   */
  private detectBlogPages(pages: DiscoveredPage[]): DiscoveredPage[] {
    const BLOG_THRESHOLD = 5;
    const BLOG_SEGMENTS = ['blog', 'post', 'article', 'news', 'updates', 'insights', 'resources'];
    
    // Group pages by potential blog pattern
    const patternGroups = new Map<string, DiscoveredPage[]>();
    
    for (const page of pages) {
      try {
        const url = new URL(page.url);
        const pathParts = url.pathname.split('/').filter(p => p.length > 0);
        
        // Check for blog segments
        for (const segment of BLOG_SEGMENTS) {
          const index = pathParts.findIndex(p => p.toLowerCase() === segment);
          if (index >= 0) {
            const pattern = '/' + pathParts.slice(0, index + 1).join('/') + '/';
            if (!patternGroups.has(pattern)) {
              patternGroups.set(pattern, []);
            }
            patternGroups.get(pattern)!.push(page);
            break;
          }
        }
        
        // Check for date patterns (YYYY, YYYY/MM, YYYY/MM/DD)
        const datePattern = pathParts.find(p => /^\d{4}$/.test(p));
        if (datePattern) {
          const index = pathParts.indexOf(datePattern);
          const pattern = '/' + pathParts.slice(0, index + 1).join('/') + '/';
          if (!patternGroups.has(pattern)) {
            patternGroups.set(pattern, []);
          }
          patternGroups.get(pattern)!.push(page);
        }
      } catch (error) {
        // Skip invalid URLs
        continue;
      }
    }
    
    // Mark pages as blog if they're part of a group with 5+ pages
    const blogUrls = new Set<string>();
    for (const [pattern, groupPages] of patternGroups) {
      if (groupPages.length >= BLOG_THRESHOLD) {
        logger.info('sitemap-discovery.blog-pattern-detected', {
          pattern,
          count: groupPages.length
        });
        
        for (const page of groupPages) {
          blogUrls.add(page.url);
        }
        
        // Also mark the index page as blog (e.g., /blog/, /news/)
        try {
          if (pages.length > 0 && pages[0]) {
            const indexUrl = new URL(pattern, pages[0].url).href;
            blogUrls.add(indexUrl);
          }
        } catch {
          // Skip if URL construction fails
        }
      }
    }
    
    // Mark pages
    return pages.map(page => ({
      ...page,
      isBlog: blogUrls.has(page.url)
    }));
  }

  /**
   * Count pages by source
   * 
   * @param pages - Array of pages
   * @returns Object with source counts
   */
  private countSources(pages: DiscoveredPage[]): Record<string, number> {
    const counts: Record<string, number> = {
      sitemap: 0,
      robots: 0,
      crawl: 0
    };

    for (const page of pages) {
      const source = page.source;
      if (source && counts[source] !== undefined) {
        counts[source]++;
      }
    }

    return counts;
  }

  /**
   * Extract internal links from a page
   *
   * @param pageUrl - URL of the page to extract links from
   * @returns Promise resolving to array of link URLs
   */
  private async extractLinksFromPage(pageUrl: string): Promise<string[]> {
    try {
      const response = await fetch(pageUrl);
      if (!response.ok) {
        logger.warn('sitemap-discovery.extract-links.failed', {
          pageUrl,
          status: response.status
        });
        return [];
      }

      const finalUrl = response.url || pageUrl;
      const finalUrlObj = new URL(finalUrl);
      const html = await response.text();
      const links: string[] = [];

      const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["']/gi;
      let match;

      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1];
        if (!href) continue;

        try {
          const url = new URL(href, finalUrl);
          // Only include same-hostname URLs without hash fragments
          // Remove query parameters to avoid duplicate pages like /about and /about?utm_source=...
          if (url.hostname === finalUrlObj.hostname && !url.hash) {
            url.search = '';
            links.push(url.href);
          }
        } catch {
          // Ignore malformed URLs
          continue;
        }
      }

      return links;
    } catch (error) {
      logger.warn('sitemap-discovery.extract-links.error', {
        pageUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Check if a URL matches the path prefix
   *
   * @param url - URL to check
   * @param pathPrefix - Path prefix to match against
   * @returns True if URL path starts with the prefix
   */
  private matchesPathPrefix(url: string, pathPrefix: string): boolean {
    try {
      const urlObj = new URL(url);
      const normalizedPath = urlObj.pathname.replace(/\/$/, '') || '/';
      const normalizedPrefix = pathPrefix.replace(/\/$/, '') || '/';

      // Root prefix matches everything on the same domain
      if (normalizedPrefix === '/') {
        return true;
      }

      // Check if path starts with prefix
      return normalizedPath === normalizedPrefix || normalizedPath.startsWith(normalizedPrefix + '/');
    } catch {
      return false;
    }
  }
}
