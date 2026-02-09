import type { AxeResults, PlaywrightPage } from '../playwright-types.js';
import type { AccessibilityScore, AccessibilityViolation, EvaluatorResult } from '../types.js';

/**
 * Evaluates accessibility using axe-core via Playwright
 * Checks WCAG 2.0, 2.1, and 2.2 at levels A and AA
 */
export async function evaluate(
  page: PlaywrightPage
): Promise<EvaluatorResult<AccessibilityScore>> {
  const startTime = Date.now();

  try {
    // Dynamic import to handle cases where axe-core is not installed
    const axeModule = await import('@axe-core/playwright');
    const AxeBuilder = axeModule.AxeBuilder;

    const results: AxeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();

    // Count violations by impact level
    const violations = {
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
    };

    const details: AccessibilityViolation[] = [];

    for (const violation of results.violations) {
      const impact = violation.impact as 'critical' | 'serious' | 'moderate' | 'minor';
      if (impact in violations) {
        violations[impact]++;
      }

      details.push({
        id: violation.id,
        impact: impact || 'minor',
        description: violation.description,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.length,
      });
    }

    // Calculate score: 100 minus weighted penalties
    // Critical: -25, Serious: -15, Moderate: -5, Minor: -1
    const score = Math.max(0, 100 - (
      violations.critical * 25 +
      violations.serious * 15 +
      violations.moderate * 5 +
      violations.minor * 1
    ));

    const data: AccessibilityScore = {
      score,
      violations,
      passedChecks: results.passes.length,
      details,
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    // Fallback to basic accessibility checks if axe-core fails
    return evaluateBasic(page, startTime, error);
  }
}

/**
 * Basic accessibility evaluation using DOM inspection
 * Used as fallback when axe-core is not available
 */
async function evaluateBasic(
  page: PlaywrightPage,
  startTime: number,
  originalError?: unknown
): Promise<EvaluatorResult<AccessibilityScore>> {
  try {
    const checks = await page.evaluate((): { issues: Array<{ id: string; impact: string; description: string; nodes: number }>; passedChecks: number } => {
      const issues: Array<{ id: string; impact: string; description: string; nodes: number }> = [];

      // Check images without alt text
      const imagesWithoutAlt = document.querySelectorAll('img:not([alt])');
      if (imagesWithoutAlt.length > 0) {
        issues.push({
          id: 'image-alt',
          impact: 'critical',
          description: 'Images must have alt text',
          nodes: imagesWithoutAlt.length,
        });
      }

      // Check form inputs without labels
      const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
      let inputsWithoutLabels = 0;
      inputs.forEach(input => {
        const id = input.getAttribute('id');
        const ariaLabel = input.getAttribute('aria-label');
        const ariaLabelledBy = input.getAttribute('aria-labelledby');
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        if (!hasLabel && !ariaLabel && !ariaLabelledBy) {
          inputsWithoutLabels++;
        }
      });
      if (inputsWithoutLabels > 0) {
        issues.push({
          id: 'label',
          impact: 'serious',
          description: 'Form inputs must have associated labels',
          nodes: inputsWithoutLabels,
        });
      }

      // Check for empty links
      const emptyLinks = document.querySelectorAll('a:not([aria-label])');
      let emptyLinkCount = 0;
      emptyLinks.forEach(link => {
        if (!link.textContent?.trim() && !link.querySelector('img[alt]')) {
          emptyLinkCount++;
        }
      });
      if (emptyLinkCount > 0) {
        issues.push({
          id: 'link-name',
          impact: 'serious',
          description: 'Links must have discernible text',
          nodes: emptyLinkCount,
        });
      }

      // Check heading hierarchy
      const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      let previousLevel = 0;
      let skippedLevels = 0;
      headings.forEach(heading => {
        const level = parseInt(heading.tagName[1], 10);
        if (previousLevel > 0 && level > previousLevel + 1) {
          skippedLevels++;
        }
        previousLevel = level;
      });
      if (skippedLevels > 0) {
        issues.push({
          id: 'heading-order',
          impact: 'moderate',
          description: 'Heading levels should not be skipped',
          nodes: skippedLevels,
        });
      }

      // Check for lang attribute on html
      const htmlLang = document.documentElement.getAttribute('lang');
      if (!htmlLang) {
        issues.push({
          id: 'html-lang',
          impact: 'serious',
          description: 'HTML element must have lang attribute',
          nodes: 1,
        });
      }

      // Check color contrast (basic check for very light text)
      const textElements = document.querySelectorAll('p, span, a, li, h1, h2, h3, h4, h5, h6');
      let potentialContrastIssues = 0;
      textElements.forEach(el => {
        const style = window.getComputedStyle(el);
        const color = style.color;
        const bgColor = style.backgroundColor;
        // Very basic check - if both are very light or very dark
        if (color && bgColor) {
          const colorMatch = color.match(/\d+/g);
          const bgMatch = bgColor.match(/\d+/g);
          if (colorMatch && bgMatch) {
            const [r, g, b] = colorMatch.map(Number);
            const [bgR, bgG, bgB] = bgMatch.map(Number);
            const textLuminance = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            const bgLuminance = (bgR * 0.299 + bgG * 0.587 + bgB * 0.114) / 255;
            const contrast = Math.abs(textLuminance - bgLuminance);
            if (contrast < 0.2) {
              potentialContrastIssues++;
            }
          }
        }
      });
      if (potentialContrastIssues > 5) {
        issues.push({
          id: 'color-contrast',
          impact: 'serious',
          description: 'Text may have insufficient color contrast',
          nodes: potentialContrastIssues,
        });
      }

      // Check for keyboard focusable elements
      const focusableElements = document.querySelectorAll('a, button, input, select, textarea, [tabindex]');
      let nonFocusable = 0;
      focusableElements.forEach(el => {
        const tabindex = el.getAttribute('tabindex');
        if (tabindex === '-1' && !el.getAttribute('aria-hidden')) {
          nonFocusable++;
        }
      });
      if (nonFocusable > 0) {
        issues.push({
          id: 'focusable-no-name',
          impact: 'moderate',
          description: 'Interactive elements should be focusable',
          nodes: nonFocusable,
        });
      }

      return {
        issues,
        passedChecks: 10 - issues.length, // Rough estimate
      };
    });

    // Convert to AccessibilityViolation format
    const details: AccessibilityViolation[] = checks.issues.map(issue => ({
      id: issue.id,
      impact: issue.impact as 'critical' | 'serious' | 'moderate' | 'minor',
      description: issue.description,
      helpUrl: `https://dequeuniversity.com/rules/axe/4.4/${issue.id}`,
      nodes: issue.nodes,
    }));

    // Count by severity
    const violations = {
      critical: details.filter(d => d.impact === 'critical').length,
      serious: details.filter(d => d.impact === 'serious').length,
      moderate: details.filter(d => d.impact === 'moderate').length,
      minor: details.filter(d => d.impact === 'minor').length,
    };

    const score = Math.max(0, 100 - (
      violations.critical * 25 +
      violations.serious * 15 +
      violations.moderate * 5 +
      violations.minor * 1
    ));

    return {
      success: true,
      data: {
        score,
        violations,
        passedChecks: checks.passedChecks,
        details,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: originalError instanceof Error
        ? `axe-core failed: ${originalError.message}. Fallback also failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        : `Accessibility evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration: Date.now() - startTime,
    };
  }
}
