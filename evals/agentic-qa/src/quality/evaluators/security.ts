import type { PlaywrightPage } from '../playwright-types.js';
import type { EvaluatorResult, SecurityHeaders, SecurityScore } from '../types.js';

/**
 * Evaluates basic security: HTTPS, headers, mixed content
 */
export async function evaluate(
  page: PlaywrightPage
): Promise<EvaluatorResult<SecurityScore>> {
  const startTime = Date.now();

  try {
    const url = page.url();
    const isHttps = url.startsWith('https://');

    // Check for mixed content (HTTP resources on HTTPS page)
    const mixedContent = await page.evaluate(() => {
      const httpResources: string[] = [];

      // Check all elements with src attribute
      const srcElements = document.querySelectorAll('[src]');
      srcElements.forEach(el => {
        const src = el.getAttribute('src');
        if (src?.startsWith('http://')) {
          httpResources.push(src);
        }
      });

      // Check all elements with href attribute (stylesheets, etc.)
      const hrefElements = document.querySelectorAll('link[href], a[href]');
      hrefElements.forEach(el => {
        const href = el.getAttribute('href');
        const rel = el.getAttribute('rel');
        // Only flag stylesheets and preloads, not regular links
        if (href?.startsWith('http://') && (rel === 'stylesheet' || rel === 'preload')) {
          httpResources.push(href);
        }
      });

      // Check inline styles for http:// URLs
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const style = el.getAttribute('style');
        if (style?.includes('http://')) {
          const match = style.match(/url\(['"]?(http:\/\/[^'")\s]+)['"]?\)/);
          if (match) {
            httpResources.push(match[1]);
          }
        }
      });

      return [...new Set(httpResources)]; // Remove duplicates
    });

    // Try to get security headers
    let securityHeaders: SecurityHeaders = {
      xFrameOptions: false,
      contentSecurityPolicy: false,
      xContentTypeOptions: false,
      strictTransportSecurity: false,
    };

    try {
      // Make a request to get headers
      const response = await page.request.get(url, {
        headers: {
          'Accept': 'text/html',
        },
      });

      const headers = response.headers();

      securityHeaders = {
        xFrameOptions: !!headers['x-frame-options'],
        contentSecurityPolicy: !!headers['content-security-policy'],
        xContentTypeOptions: !!headers['x-content-type-options'],
        strictTransportSecurity: !!headers['strict-transport-security'],
      };
    } catch {
      // Headers check failed, continue with defaults
    }

    // Check for exposed sensitive information in page
    const exposedSecrets = await page.evaluate(() => {
      const pageContent = document.documentElement.innerHTML;
      const patterns = [
        /api[_-]?key['"]\s*[:=]\s*['"][a-zA-Z0-9]{20,}/i,
        /secret[_-]?key['"]\s*[:=]\s*['"][a-zA-Z0-9]{20,}/i,
        /password['"]\s*[:=]\s*['"][^'"]{8,}/i,
        /bearer\s+[a-zA-Z0-9._-]{20,}/i,
      ];

      const found: string[] = [];
      patterns.forEach(pattern => {
        if (pattern.test(pageContent)) {
          found.push(pattern.source.split('[')[0]); // Just the pattern name
        }
      });

      return found;
    });

    // Calculate score
    let score = 100;

    // HTTPS is critical (-40 if missing)
    if (!isHttps) {
      score -= 40;
    }

    // Mixed content (-5 per resource, max -20)
    score -= Math.min(20, mixedContent.length * 5);

    // Security headers (each worth 10 points)
    const headerCount = Object.values(securityHeaders).filter(Boolean).length;
    const missingHeaders = 4 - headerCount;
    score -= missingHeaders * 5; // -5 per missing header, max -20

    // Exposed secrets (-20 per type found)
    score -= Math.min(40, exposedSecrets.length * 20);

    score = Math.max(0, score);

    const data: SecurityScore = {
      score,
      isHttps,
      mixedContent: mixedContent.slice(0, 10), // Limit to 10
      securityHeaders,
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during security evaluation',
      duration: Date.now() - startTime,
    };
  }
}
