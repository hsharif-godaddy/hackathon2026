import type { PlaywrightPage } from '../playwright-types.js';
import type { EvaluatorResult, VisualScore } from '../types.js';
import { callAnthropicVision, parseJsonResponse } from '../utils/anthropic-client.js';

interface ScreenshotInfo {
  path: string;
  type: string;
}

interface VisualAnalysisResult {
  aestheticScore: number;
  feedback: string;
  issues: string[];
}

/**
 * Placeholder patterns to detect in page content
 */
const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /dolor sit amet/i,
  /placeholder/i,
  /\[your (?:name|company|text|content)\]/i,
  /\[insert .*\]/i,
  /xxx+/i,
  /sample text/i,
  /coming soon/i,
  /under construction/i,
  /example\.(?:com|org|net)/i,
  /(?:^|[^\d])555-\d{4}/,  // 555-XXXX likely fake (pattern avoids lookbehind for compatibility)
  /123-456-7890/,
  /test@test\.com/i,
  /your@email\.com/i,
  /imgplaceholder/i,
  /via placeholder/i,
];

/**
 * Evaluates visual quality using DOM checks and AI vision analysis
 */
export async function evaluate(
  page: PlaywrightPage,
  options: {
    screenshots?: ScreenshotInfo[];
    anthropicApiKey?: string;
    anthropicModel?: string;
  } = {}
): Promise<EvaluatorResult<VisualScore>> {
  const startTime = Date.now();

  try {
    // Check for placeholder content
    const placeholders = await detectPlaceholders(page);

    // Check responsive design at different viewports
    const responsiveIssues = await checkResponsive(page);

    // AI vision analysis if screenshot and API key available
    let aiAestheticScore = 7; // Default score
    let aiAestheticFeedback: string | undefined;

    const previewScreenshot = options.screenshots?.find(s => s.type === 'preview') || options.screenshots?.[0];

    if (previewScreenshot && options.anthropicApiKey) {
      try {
        const aiResult = await analyzeWithVision(
          previewScreenshot.path,
          options.anthropicApiKey,
          options.anthropicModel
        );
        aiAestheticScore = aiResult.aestheticScore;
        aiAestheticFeedback = aiResult.feedback;

        // Add AI-detected issues to placeholders
        if (aiResult.issues.length > 0) {
          placeholders.push(...aiResult.issues.filter(i => i.toLowerCase().includes('placeholder')));
        }
      } catch (error) {
        console.warn('AI vision analysis failed: %s', error instanceof Error ? error.message : 'Unknown error');
        // Continue with default score
      }
    }

    // Calculate final score
    // Base: 100, minus penalties for placeholders and responsive issues
    // Then multiply by AI aesthetic factor
    const basePenalty = (placeholders.length * 10) + (responsiveIssues.length * 15);
    const baseScore = Math.max(0, 100 - basePenalty);

    // AI score acts as a multiplier (1-10 scale, so divide by 10)
    const score = Math.round(baseScore * (aiAestheticScore / 10));

    const data: VisualScore = {
      score,
      placeholders: [...new Set(placeholders)].slice(0, 10),
      responsiveIssues,
      aiAestheticScore,
      aiAestheticFeedback,
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during visual evaluation',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Detect placeholder content in the page
 */
async function detectPlaceholders(page: PlaywrightPage): Promise<string[]> {
  // Test patterns in Node.js context to avoid dynamic RegExp in the browser
  const pageText = await page.evaluate((): string => document.body.innerText || '');

  const found: string[] = [];
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(pageText)) {
      found.push(pattern.source);
    }
  }

  // Check for placeholder images in the browser
  const placeholderImages = await page.evaluate((): boolean => {
    const images = document.querySelectorAll('img');
    for (const img of images) {
      const src = img.src || '';
      const alt = img.alt || '';
      if (
        src.includes('placeholder') ||
        src.includes('placekitten') ||
        src.includes('picsum') ||
        src.includes('unsplash.it') ||
        alt.toLowerCase().includes('placeholder')
      ) {
        return true;
      }
    }
    return false;
  });

  if (placeholderImages) {
    found.push('placeholder-image');
  }

  return found;
}

/**
 * Check responsive design at different viewports
 */
async function checkResponsive(page: PlaywrightPage): Promise<string[]> {
  const issues: string[] = [];
  const viewports = [
    { width: 375, height: 667, name: 'mobile' },
    { width: 768, height: 1024, name: 'tablet' },
    { width: 1280, height: 800, name: 'desktop' },
  ];

  // Store original viewport
  const originalViewport = page.viewportSize();

  for (const viewport of viewports) {
    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(500); // Allow layout to settle

      const hasIssues = await page.evaluate(() => {
        const html = document.documentElement;
        const body = document.body;

        // Check for horizontal scroll
        const hasHorizontalScroll = html.scrollWidth > html.clientWidth ||
          body.scrollWidth > body.clientWidth;

        // Check for overlapping elements (basic check)
        const elements = document.querySelectorAll('*');
        let overlappingCount = 0;

        elements.forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.left < 0 || rect.right > window.innerWidth) {
            overlappingCount++;
          }
        });

        // Check for very small text
        let smallTextCount = 0;
        const textElements = document.querySelectorAll('p, span, a, li, td, th');
        textElements.forEach(el => {
          const style = window.getComputedStyle(el);
          const fontSize = parseFloat(style.fontSize);
          if (fontSize < 12) {
            smallTextCount++;
          }
        });

        return {
          hasHorizontalScroll,
          overlappingCount,
          smallTextCount,
        };
      });

      if (hasIssues.hasHorizontalScroll) {
        issues.push(`Horizontal scroll at ${viewport.name} (${viewport.width}px)`);
      }

      if (hasIssues.overlappingCount > 5) {
        issues.push(`Elements overflow viewport at ${viewport.name}`);
      }

      if (hasIssues.smallTextCount > 10) {
        issues.push(`Very small text detected at ${viewport.name}`);
      }
    } catch (error) {
      console.warn('Failed to check viewport %s:', viewport.name, error);
    }
  }

  // Restore original viewport
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }

  return issues;
}

/**
 * Analyze screenshot with AI vision (Claude)
 */
async function analyzeWithVision(
  imagePath: string,
  apiKey: string,
  model?: string
): Promise<VisualAnalysisResult> {
  const prompt = `Analyze this website screenshot and evaluate its visual quality.

Rate the following on a scale of 1-10:
1. Overall aesthetic appeal
2. Professional appearance
3. Visual hierarchy and layout
4. Color scheme harmony
5. Typography quality

Then provide:
- A brief feedback summary (1-2 sentences)
- List any visual issues (placeholder content, broken layouts, poor design choices)

Respond with JSON only:
{
  "aestheticScore": <average of the 5 ratings, 1-10>,
  "feedback": "<brief summary>",
  "issues": ["<issue1>", "<issue2>"]
}`;

  const response = await callAnthropicVision(imagePath, prompt, {
    apiKey,
    model,
  });

  return parseJsonResponse<VisualAnalysisResult>(response);
}
