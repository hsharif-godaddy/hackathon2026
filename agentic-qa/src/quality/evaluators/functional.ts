import type { PlaywrightPage } from '../playwright-types.js';
import type { EvaluatorResult, FunctionalScore } from '../types.js';

interface ConsoleMessage {
  type: () => string;
  text: () => string;
}

interface FailedRequest {
  url: () => string;
  resourceType: () => string;
}

/**
 * Evaluates functional integrity: links, images, JS errors, resources
 */
export async function evaluate(
  page: PlaywrightPage,
  options: {
    checkExternalLinks?: boolean;
    maxLinksToCheck?: number;
    timeout?: number;
  } = {}
): Promise<EvaluatorResult<FunctionalScore>> {
  const startTime = Date.now();
  const {
    checkExternalLinks = false,
    maxLinksToCheck = 20,
    timeout = 5000,
  } = options;

  const jsErrors: string[] = [];
  const failedResources: string[] = [];

  try {
    // Set up console error listener
    const consoleHandler = (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out common non-critical errors
        if (!text.includes('favicon') && !text.includes('404')) {
          jsErrors.push(text);
        }
      }
    };
    page.on('console', consoleHandler);

    // Set up failed request listener
    const requestFailedHandler = (request: FailedRequest) => {
      const url = request.url();
      const resourceType = request.resourceType();
      // Filter out non-critical resources
      if (!url.includes('favicon') && !url.includes('analytics') && !url.includes('tracking')) {
        failedResources.push(`${resourceType}: ${url}`);
      }
    };
    page.on('requestfailed', requestFailedHandler);

    // Wait a bit to capture any errors
    await page.waitForTimeout(1000);

    // Get page info
    const pageInfo = await page.evaluate(() => {
      // Get all links
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({
          href: a.getAttribute('href') || '',
          isExternal: (a.getAttribute('href') || '').startsWith('http'),
          text: a.textContent?.trim() || '',
        }))
        .filter(link => link.href && !link.href.startsWith('javascript:') && !link.href.startsWith('#'));

      // Get all images and check if loaded
      const images = Array.from(document.querySelectorAll('img'));
      const brokenImages: string[] = [];
      images.forEach(img => {
        if (!img.complete || img.naturalWidth === 0) {
          brokenImages.push(img.src || img.getAttribute('data-src') || 'unknown');
        }
      });

      // Check for error messages in the DOM
      const errorPatterns = [
        /error/i,
        /exception/i,
        /failed to load/i,
        /something went wrong/i,
        /page not found/i,
        /404/,
        /500/,
      ];

      const visibleErrors: string[] = [];
      const textContent = document.body.innerText || '';
      errorPatterns.forEach(pattern => {
        const match = textContent.match(pattern);
        if (match) {
          // Get surrounding context
          const index = textContent.toLowerCase().indexOf(match[0].toLowerCase());
          const start = Math.max(0, index - 20);
          const end = Math.min(textContent.length, index + match[0].length + 20);
          const context = textContent.substring(start, end).trim();
          // Filter out false positives
          if (!context.includes('Error handling') && !context.includes('error prevention')) {
            visibleErrors.push(context);
          }
        }
      });

      return {
        links,
        brokenImages,
        visibleErrors,
        totalImages: images.length,
      };
    });

    // Check internal links (navigate and check for 404)
    const brokenLinks: string[] = [];
    const internalLinks = pageInfo.links
      .filter(link => !link.isExternal || checkExternalLinks)
      .slice(0, maxLinksToCheck);

    const currentUrl = page.url();
    const baseUrl = new URL(currentUrl).origin;

    for (const link of internalLinks as Array<{ href: string; isExternal: boolean; text: string }>) {
      try {
        // Resolve relative URLs
        let fullUrl = link.href;
        if (!fullUrl.startsWith('http')) {
          fullUrl = new URL(link.href, baseUrl).href;
        }

        // Skip external links if not checking them
        if (!checkExternalLinks && !fullUrl.startsWith(baseUrl)) {
          continue;
        }

        // Use HEAD request for efficiency
        const response = await page.request.head(fullUrl, { timeout });

        if (!response.ok()) {
          brokenLinks.push(`${response.status()}: ${fullUrl}`);
        }
      } catch {
        // Network error or timeout
        brokenLinks.push(`Failed: ${link.href}`);
      }
    }

    // Clean up listeners
    page.removeListener('console', consoleHandler);
    page.removeListener('requestfailed', requestFailedHandler);

    // Calculate score
    // JS errors: -20 each (max -60)
    // Broken links: -10 each (max -40)
    // Failed resources: -5 each (max -20)
    // Broken images: -5 each (max -20)
    const jsErrorPenalty = Math.min(60, jsErrors.length * 20);
    const brokenLinkPenalty = Math.min(40, brokenLinks.length * 10);
    const failedResourcePenalty = Math.min(20, failedResources.length * 5);
    const brokenImagePenalty = Math.min(20, pageInfo.brokenImages.length * 5);

    const score = Math.max(0, 100 - jsErrorPenalty - brokenLinkPenalty - failedResourcePenalty - brokenImagePenalty);

    const data: FunctionalScore = {
      score,
      jsErrors: jsErrors.slice(0, 10), // Limit to 10
      brokenLinks: brokenLinks.slice(0, 10),
      failedResources: failedResources.slice(0, 10),
      brokenImages: pageInfo.brokenImages.slice(0, 10),
      totalLinks: pageInfo.links.length,
      totalImages: pageInfo.totalImages,
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during functional evaluation',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Quick functional check without link validation
 * Faster but less thorough
 */
export async function evaluateQuick(
  page: PlaywrightPage
): Promise<EvaluatorResult<FunctionalScore>> {
  const startTime = Date.now();

  try {
    const result = await page.evaluate(() => {
      // Check for broken images
      const images = Array.from(document.querySelectorAll('img'));
      const brokenImages = images
        .filter(img => !img.complete || img.naturalWidth === 0)
        .map(img => img.src || 'unknown');

      // Count links
      const links = document.querySelectorAll('a[href]');

      // Check for visible error messages
      const errorIndicators = document.querySelectorAll('.error, .error-message, [class*="error"]');

      return {
        brokenImages,
        totalLinks: links.length,
        totalImages: images.length,
        hasVisibleErrors: errorIndicators.length > 0,
      };
    });

    const score = Math.max(0, 100 -
      (result.brokenImages.length * 10) -
      (result.hasVisibleErrors ? 20 : 0)
    );

    return {
      success: true,
      data: {
        score,
        jsErrors: [],
        brokenLinks: [],
        failedResources: [],
        brokenImages: result.brokenImages,
        totalLinks: result.totalLinks,
        totalImages: result.totalImages,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}
