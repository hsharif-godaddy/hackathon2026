import type { PlaywrightPage } from '../playwright-types.js';
import type { EvaluatorResult, SEOChecks, SEOScore } from '../types.js';

/**
 * Weights for SEO score calculation
 */
const SEO_WEIGHTS = {
  hasTitle: 15,
  hasMetaDescription: 10,
  hasSingleH1: 10,
  hasCanonical: 10,
  hasViewport: 10,
  imageAltRate: 15,
  hasStructuredData: 5,
  isHttps: 10,
  hasRobotsMeta: 5,
  // Extra points for quality
  titleLength: 5,
  metaDescriptionLength: 5,
};

/**
 * Evaluates SEO fundamentals using DOM inspection
 */
export async function evaluate(
  page: PlaywrightPage
): Promise<EvaluatorResult<SEOScore>> {
  const startTime = Date.now();

  try {
    const checks = await page.evaluate(() => {
      // Title check
      const title = document.title || '';
      const hasTitle = title.length >= 10 && title.length <= 70;
      const titleLength = title.length;

      // Meta description
      const metaDescEl = document.querySelector('meta[name="description"]');
      const metaDesc = metaDescEl?.getAttribute('content') || '';
      const hasMetaDescription = metaDesc.length >= 50 && metaDesc.length <= 160;
      const metaDescriptionLength = metaDesc.length;

      // H1 check
      const h1Elements = document.querySelectorAll('h1');
      const h1Count = h1Elements.length;
      const hasSingleH1 = h1Count === 1;

      // Canonical URL
      const canonicalEl = document.querySelector('link[rel="canonical"]');
      const hasCanonical = !!canonicalEl?.getAttribute('href');

      // Viewport meta
      const viewportEl = document.querySelector('meta[name="viewport"]');
      const hasViewport = !!viewportEl?.getAttribute('content');

      // Image alt text
      const allImages = document.querySelectorAll('img');
      const totalImages = allImages.length;
      let imagesWithoutAlt = 0;
      allImages.forEach(img => {
        const alt = img.getAttribute('alt');
        if (alt === null || alt === undefined) {
          imagesWithoutAlt++;
        }
      });
      const imageAltRate = totalImages > 0 ? (totalImages - imagesWithoutAlt) / totalImages : 1;

      // Structured data (JSON-LD)
      const structuredDataElements = document.querySelectorAll('script[type="application/ld+json"]');
      const hasStructuredData = structuredDataElements.length > 0;

      // HTTPS check
      const isHttps = window.location.protocol === 'https:';

      // Robots meta
      const robotsEl = document.querySelector('meta[name="robots"]');
      const robotsContent = robotsEl?.getAttribute('content') || '';
      const hasRobotsMeta = !!robotsEl;
      const isIndexable = !robotsContent.includes('noindex');

      // Additional SEO checks
      const hasOpenGraph = !!document.querySelector('meta[property^="og:"]');
      const hasTwitterCards = !!document.querySelector('meta[name^="twitter:"]');

      // Check heading hierarchy
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      let hasProperHierarchy = true;
      let lastLevel = 0;
      headings.forEach(heading => {
        const level = parseInt(heading.tagName[1], 10);
        if (lastLevel > 0 && level > lastLevel + 1) {
          hasProperHierarchy = false;
        }
        lastLevel = level;
      });

      return {
        hasTitle,
        titleLength,
        hasMetaDescription,
        metaDescriptionLength,
        hasSingleH1,
        h1Count,
        hasCanonical,
        hasViewport,
        imageAltRate,
        imagesWithoutAlt,
        totalImages,
        hasStructuredData,
        isHttps,
        hasRobotsMeta,
        isIndexable,
        hasOpenGraph,
        hasTwitterCards,
        hasProperHierarchy,
      };
    });

    // Calculate score
    let score = 0;

    // Basic checks
    if (checks.hasTitle) score += SEO_WEIGHTS.hasTitle;
    if (checks.hasMetaDescription) score += SEO_WEIGHTS.hasMetaDescription;
    if (checks.hasSingleH1) score += SEO_WEIGHTS.hasSingleH1;
    if (checks.hasCanonical) score += SEO_WEIGHTS.hasCanonical;
    if (checks.hasViewport) score += SEO_WEIGHTS.hasViewport;
    if (checks.hasStructuredData) score += SEO_WEIGHTS.hasStructuredData;
    if (checks.isHttps) score += SEO_WEIGHTS.isHttps;
    if (checks.hasRobotsMeta) score += SEO_WEIGHTS.hasRobotsMeta;

    // Image alt rate (proportional)
    score += Math.round(checks.imageAltRate * SEO_WEIGHTS.imageAltRate);

    // Title length quality bonus
    if (checks.titleLength >= 30 && checks.titleLength <= 60) {
      score += SEO_WEIGHTS.titleLength;
    } else if (checks.titleLength >= 10) {
      score += Math.round(SEO_WEIGHTS.titleLength * 0.5);
    }

    // Meta description length quality bonus
    if (checks.metaDescriptionLength >= 120 && checks.metaDescriptionLength <= 155) {
      score += SEO_WEIGHTS.metaDescriptionLength;
    } else if (checks.metaDescriptionLength >= 50) {
      score += Math.round(SEO_WEIGHTS.metaDescriptionLength * 0.5);
    }

    // Cap at 100
    score = Math.min(100, score);

    const data: SEOScore = {
      score,
      checks: {
        hasTitle: checks.hasTitle,
        titleLength: checks.titleLength,
        hasMetaDescription: checks.hasMetaDescription,
        metaDescriptionLength: checks.metaDescriptionLength,
        hasSingleH1: checks.hasSingleH1,
        h1Count: checks.h1Count,
        hasCanonical: checks.hasCanonical,
        hasViewport: checks.hasViewport,
        imageAltRate: checks.imageAltRate,
        imagesWithoutAlt: checks.imagesWithoutAlt,
        totalImages: checks.totalImages,
        hasStructuredData: checks.hasStructuredData,
        isHttps: checks.isHttps,
        hasRobotsMeta: checks.hasRobotsMeta,
      },
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during SEO evaluation',
      duration: Date.now() - startTime,
    };
  }
}
