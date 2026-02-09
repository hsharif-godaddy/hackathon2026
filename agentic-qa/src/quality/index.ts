import type { PlaywrightBrowser, PlaywrightContext, PlaywrightPage } from './playwright-types.js';

import type {
  EvaluationCategory,
  EvaluationMode,
  QualityEvalConfig,
  QualityEvaluation,
  QualityEvaluationOptions,
  StandaloneEvalRequest,
} from './types.js';
import { QualityEvalConfigSchema } from './types.js';
import * as accessibility from './evaluators/accessibility.js';
import * as businessFit from './evaluators/business-fit.js';
import * as content from './evaluators/content.js';
import * as functional from './evaluators/functional.js';
import { evaluate as evaluatePerformance, evaluateWithNavigationTiming } from './evaluators/performance.js';
import * as security from './evaluators/security.js';
import * as seo from './evaluators/seo.js';
import * as usability from './evaluators/usability.js';
import * as visual from './evaluators/visual.js';
import { calculateOverallScore, meetsThresholds } from './scorer.js';

export * from './types.js';
export { calculateOverallScore, getScoreSummary, meetsThresholds } from './scorer.js';

interface ScreenshotInfo {
  path: string;
  type: string;
}

/**
 * Run quality evaluation on a website
 *
 * Supports two modes:
 * 1. Post-build: Called after scenario builds website, uses existing page context
 * 2. Standalone: Evaluates any URL directly, creates its own browser context
 */
export async function evaluate(
  options: QualityEvaluationOptions
): Promise<QualityEvaluation> {
  const startTime = Date.now();
  const config = QualityEvalConfigSchema.parse(options.config);

  // Determine evaluation mode
  const mode: EvaluationMode = options.page ? 'post-build' : 'standalone';

  // Categories to evaluate
  const allCategories: EvaluationCategory[] = [
    'performance', 'accessibility', 'seo', 'functional',
    'visual', 'content', 'security', 'usability', 'businessFit',
  ];
  const categoriesToEvaluate = allCategories.filter(
    cat => !config.skipCategories.includes(cat)
  );

  // Results accumulator
  const evaluation: Partial<QualityEvaluation> = {};

  // Get or create page
  let page: PlaywrightPage;
  let browser: PlaywrightBrowser | undefined;

  try {
    if (options.page) {
      page = options.page;
    } else {
      // Standalone mode: launch browser (dynamic import)
      const playwright = await import('playwright');
      browser = toBrowser(await playwright.chromium.launch({
        headless: options.headless !== false,
      }));
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      page = toPage(await context.newPage());

      // Navigate to URL
      await page.goto(options.url, {
        waitUntil: 'networkidle',
        timeout: options.timeout || 30000,
      });
    }
    // Run evaluators in parallel where possible
    const evaluatorPromises: Promise<void>[] = [];

    // Deterministic evaluators (no AI, run in parallel)
    if (categoriesToEvaluate.includes('performance')) {
      evaluatorPromises.push(
        (async () => {
          // Try Lighthouse first, fall back to Navigation Timing
          if (options.chromePort) {
            const result = await evaluatePerformance(options.url, options.chromePort);
            if (result.success && result.data) {
              evaluation.performance = result.data;
            }
          } else {
            const result = await evaluateWithNavigationTiming(page);
            if (result.success && result.data) {
              evaluation.performance = result.data;
            }
          }
        })()
      );
    }

    if (categoriesToEvaluate.includes('accessibility')) {
      evaluatorPromises.push(
        (async () => {
          const result = await accessibility.evaluate(page);
          if (result.success && result.data) {
            evaluation.accessibility = result.data;
          }
        })()
      );
    }

    if (categoriesToEvaluate.includes('seo')) {
      evaluatorPromises.push(
        (async () => {
          const result = await seo.evaluate(page);
          if (result.success && result.data) {
            evaluation.seo = result.data;
          }
        })()
      );
    }

    if (categoriesToEvaluate.includes('functional')) {
      evaluatorPromises.push(
        (async () => {
          const result = await functional.evaluate(page, {
            timeout: options.timeout || 5000,
          });
          if (result.success && result.data) {
            evaluation.functional = result.data;
          }
        })()
      );
    }

    if (categoriesToEvaluate.includes('security')) {
      evaluatorPromises.push(
        (async () => {
          const result = await security.evaluate(page);
          if (result.success && result.data) {
            evaluation.security = result.data;
          }
        })()
      );
    }

    // Wait for deterministic evaluators
    await Promise.all(evaluatorPromises);

    // AI-powered evaluators (run in parallel, concurrency=2 to avoid overwhelming the API)
    const aiEvaluators: Array<() => Promise<void>> = [];

    if (categoriesToEvaluate.includes('visual')) {
      aiEvaluators.push(async () => {
        const result = await visual.evaluate(page, {
          screenshots: options.screenshots as ScreenshotInfo[],
          anthropicApiKey: options.anthropicApiKey,
          anthropicModel: options.anthropicModel,
        });
        if (result.success && result.data) {
          evaluation.visual = result.data;
        }
      });
    }

    if (categoriesToEvaluate.includes('content')) {
      aiEvaluators.push(async () => {
        const result = await content.evaluate(page, {
          originalPrompt: config.originalPrompt,
          anthropicApiKey: options.anthropicApiKey,
          anthropicModel: options.anthropicModel,
        });
        if (result.success && result.data) {
          evaluation.content = result.data;
        }
      });
    }

    if (categoriesToEvaluate.includes('usability')) {
      aiEvaluators.push(async () => {
        const result = await usability.evaluate({
          screenshots: options.screenshots as ScreenshotInfo[],
          anthropicApiKey: options.anthropicApiKey,
          anthropicModel: options.anthropicModel,
        });
        if (result.success && result.data) {
          evaluation.usability = result.data;
        }
      });
    }

    if (categoriesToEvaluate.includes('businessFit')) {
      aiEvaluators.push(async () => {
        const result = await businessFit.evaluate(page, {
          siteType: config.siteType,
          originalPrompt: config.originalPrompt,
          anthropicApiKey: options.anthropicApiKey,
          anthropicModel: options.anthropicModel,
        });
        if (result.success && result.data) {
          evaluation.businessFit = result.data;
        }
      });
    }

    // Run AI evaluators with concurrency limit of 2
    await runWithConcurrency(aiEvaluators, 2);

    // Calculate overall score
    const overall = calculateOverallScore(evaluation);

    // Build final result
    const result: QualityEvaluation = {
      ...evaluation,
      overall,
      metadata: {
        url: options.url,
        evaluatedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
        categoriesEvaluated: categoriesToEvaluate,
        categoriesSkipped: config.skipCategories,
      },
    };

    return result;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Standalone evaluation entry point
 * Evaluates any website URL without needing a scenario
 */
export async function evaluateStandalone(
  request: StandaloneEvalRequest
): Promise<{
  evaluation: QualityEvaluation;
  meetsThresholds: boolean;
  thresholdFailures: string[];
}> {
  const config: QualityEvalConfig = {
    enabled: true,
    siteType: request.siteType,
    skipCategories: request.skipCategories || [],
    originalPrompt: request.originalPrompt,
    thresholds: {
      minOverallScore: 70,
      minPerformance: 50,
      minAccessibility: 80,
    },
  };

  const evaluation = await evaluate({
    url: request.url,
    config,
    anthropicApiKey: request.anthropicApiKey,
    anthropicModel: request.anthropicModel,
    headless: request.headless,
    timeout: request.timeout,
  });

  const thresholdResult = meetsThresholds(evaluation, config.thresholds || {});

  return {
    evaluation,
    meetsThresholds: thresholdResult.passes,
    thresholdFailures: thresholdResult.failures,
  };
}

/**
 * Quick evaluation with only essential checks (no AI)
 * Useful for fast feedback loops
 */
export async function evaluateQuick(
  url: string,
  options: {
    headless?: boolean;
    timeout?: number;
  } = {}
): Promise<QualityEvaluation> {
  return evaluate({
    url,
    config: {
      enabled: true,
      siteType: 'generic',
      skipCategories: ['visual', 'content', 'usability', 'businessFit'], // Skip AI evaluators
      thresholds: {
        minOverallScore: 70,
        minPerformance: 50,
        minAccessibility: 80,
      },
    },
    headless: options.headless,
    timeout: options.timeout,
  });
}

/**
 * Runtime validation that a Playwright browser object matches our minimal interface.
 * Throws if the object is missing required methods.
 */
function toBrowser(obj: unknown): PlaywrightBrowser {
  const browser = obj as Record<string, unknown>;
  if (typeof browser.newContext !== 'function' || typeof browser.close !== 'function') {
    throw new Error('Playwright browser object missing required methods (newContext, close)');
  }
  return browser as unknown as PlaywrightBrowser;
}

/**
 * Runtime validation that a Playwright page object matches our minimal interface.
 * Throws if the object is missing required methods.
 */
function toPage(obj: unknown): PlaywrightPage {
  const page = obj as Record<string, unknown>;
  const required = ['goto', 'url', 'evaluate', 'setViewportSize', 'viewportSize', 'waitForTimeout', 'on', 'removeListener', 'content'];
  for (const method of required) {
    if (typeof page[method] !== 'function') {
      throw new Error(`Playwright page object missing required method: ${method}`);
    }
  }
  return page as unknown as PlaywrightPage;
}

/**
 * Run async tasks with a concurrency limit.
 * Executes up to `limit` tasks simultaneously, settling all before returning.
 */
async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number
): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const task of tasks) {
    const p = task().then(
      () => { executing.delete(p); },
      () => { executing.delete(p); }
    );
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}
