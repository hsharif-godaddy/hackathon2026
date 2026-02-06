import { Stagehand } from '@browserbasehq/stagehand';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Scenario, EvalResult, ScreenshotInfo, PreviewScreenshot } from './scenarios/types.js';
import { deleteAllSitesViaAPI, deleteOldestSitesIfOverLimit } from './utils/auth.js';
import { runDeterministicSetup } from './utils/deterministic-actions.js';

export interface RunnerOptions {
  headed?: boolean;
  screenshotDir?: string;
  model?: string;
  verbose?: boolean;
}

export async function runScenario(
  scenario: Scenario,
  options: RunnerOptions = {}
): Promise<EvalResult> {
  const startTime = Date.now();
  const screenshots: ScreenshotInfo[] = [];
  let previewUrl: string | undefined;

  // Configure Stagehand with the model
  // GoDaddy proxy expects just the model name without provider prefix
  const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4';
  const modelName = options.model || defaultModel;

  console.log(`Using model: ${modelName}`);
  console.log(`Base URL: ${process.env.OPENAI_BASE_URL || 'default OpenAI'}`);

  // Use model config object for custom endpoint
  const modelConfig = process.env.OPENAI_BASE_URL
    ? {
        modelName: modelName, // Just the model name, no prefix
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
      }
    : `openai/${modelName}`;

  // CI environments need additional Chrome args
  const isCI = process.env.CI === 'true';
  const chromeArgs = isCI
    ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    : [];

  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: 1, // 0=none, 1=info, 2=debug
    model: modelConfig,
    localBrowserLaunchOptions: {
      headless: !(options.headed ?? scenario.headed),
      args: chromeArgs,
    },
  });

  try {
    console.log(`\nRunning scenario: ${scenario.name}`);
    console.log(`Goal: ${scenario.goal.substring(0, 100)}...`);

    await stagehand.init();

    const page = stagehand.context.pages()[0];
    if (!page) {
      throw new Error('No browser page available');
    }

    // Check if we should handle login deterministically (default: true)
    const handleLogin = scenario.sitePrompt?.handleLogin ?? true;

    // If handling login deterministically, we'll navigate to SSO first then Airo
    // Otherwise, navigate directly to the start URL
    if (!handleLogin) {
      console.log(`Navigating to: ${scenario.startUrl}`);
      await page.goto(scenario.startUrl, { waitUntil: 'domcontentloaded' });
    } else {
      console.log('Will navigate to SSO for login first, then to Airo');
    }

    // Take initial screenshot
    if (options.screenshotDir) {
      const initialScreenshot = await captureScreenshot(
        page,
        options.screenshotDir,
        `${scenario.name}-initial`,
        { type: 'initial', url: handleLogin ? 'sso.godaddy.com' : scenario.startUrl }
      );
      screenshots.push(initialScreenshot);
    }

    // Run deterministic setup if configured (prompt entry, start building, and optionally login)
    // This uses Playwright selectors instead of AI for faster, more reliable execution
    if (scenario.sitePrompt?.enabled !== false && scenario.sitePrompt?.prompt) {
      console.log('\n========== SITE PROMPT SETUP ==========');

      if (handleLogin) {
        console.log('Flow: SSO Login -> Navigate to Airo -> Enter prompt -> Click Start building');
      } else {
        console.log('Using Playwright selectors for prompt entry and start building');
      }

      const setupResult = await runDeterministicSetup(page, {
        prompt: scenario.sitePrompt.prompt,
        credentials: scenario.credentials,
        handleLogin,
      }, scenario.startUrl); // Pass the Airo URL to navigate to after login

      if (!setupResult.success) {
        console.error(`Deterministic setup failed: ${setupResult.error}`);
        throw new Error(`Deterministic setup failed: ${setupResult.error}`);
      }

      if (handleLogin) {
        console.log('Deterministic setup completed - now on develop page');
      } else {
        console.log('Deterministic setup completed - AI agent will handle login and verification');
      }
      console.log('==========================================\n');

      // Wait for page to stabilize
      await page.waitForTimeout(2000);

      // Clean up old sites if over limit (before creating new one)
      await deleteOldestSitesIfOverLimit(stagehand, 100);
    }

    // Create agent
    const agent = stagehand.agent({
      systemPrompt: scenario.systemPrompt || `You are a QA tester for Airo Builder.
Your goal is to complete the test scenario by interacting with the web application.
Be patient with loading times - site creation can take up to 5 minutes.
If you encounter a sign-in form, use the provided credentials.
Always verify the final state matches the expected outcome.`,
    });

    console.log('Starting agent execution...');

    // Pass credentials as part of the instruction if provided
    let instruction = scenario.goal;
    if (scenario.credentials) {
      instruction += `\n\nCredentials for sign-in if needed:
- Username: ${scenario.credentials.username}
- Password: ${scenario.credentials.password}`;
    }

    console.log('\n========== AGENT INSTRUCTION ==========');
    console.log(instruction);
    console.log('========================================\n');

    const result = await agent.execute({
      instruction,
      maxSteps: scenario.maxSteps,
    });

    // Log the full result for debugging
    console.log('\n========== AGENT RESULT ==========');
    console.log('Success:', result.success);
    console.log('Message:', result.message);
    console.log('Actions:', JSON.stringify(result.actions, null, 2));
    console.log('===================================\n');

    // Log step count from result
    const stepCount = result.actions?.length || 0;
    console.log(`  Completed ${stepCount} steps`);

    // Take final screenshot of develop page
    if (options.screenshotDir) {
      const finalScreenshot = await captureScreenshot(
        page,
        options.screenshotDir,
        `${scenario.name}-final`,
        { type: 'final', url: page.url() }
      );
      screenshots.push(finalScreenshot);
    }

    // Navigate to preview and take screenshots if enabled
    const previewConfig: Partial<PreviewScreenshot> & { enabled?: boolean } = scenario.previewScreenshots ?? { enabled: true };
    if (previewConfig.enabled !== false && options.screenshotDir) {
      try {
        previewUrl = await capturePreviewScreenshots(
          stagehand,
          page,
          options.screenshotDir,
          scenario.name,
          previewConfig,
          screenshots
        );
      } catch (previewError) {
        console.warn('Failed to capture preview screenshots:', previewError);
      }
    }

    // Run cleanup if specified
    if (scenario.cleanup?.deleteAllSitesViaAPI) {
      await deleteAllSitesViaAPI(stagehand);
    }

    const duration = Date.now() - startTime;

    // Get metrics
    const metrics = await stagehand.metrics;

    const resultActions = result.actions || [];
    console.log(`Scenario completed: ${result.success ? 'PASSED' : 'FAILED'}`);
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`  Steps: ${resultActions.length}`);

    await stagehand.close();

    return {
      scenario: scenario.name,
      success: result.success,
      message: result.message || '',
      steps: resultActions.length,
      duration,
      actions: resultActions.map((a: unknown) => {
        const action = a as Record<string, unknown>;
        return {
          type: String(action.type || ''),
          reasoning: action.reasoning as string | undefined,
          taskCompleted: Boolean(action.taskCompleted),
          action: action.action as string | undefined,
          pageUrl: action.pageUrl as string | undefined,
          timestamp: Number(action.timestamp || Date.now()),
        };
      }),
      usage: {
        inputTokens: metrics?.totalPromptTokens || 0,
        outputTokens: metrics?.totalCompletionTokens || 0,
        reasoningTokens: metrics?.totalReasoningTokens || 0,
      },
      screenshots,
      previewUrl,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error(`Scenario failed with error: ${error}`);

    // Try to take error screenshot
    try {
      if (options.screenshotDir) {
        const page = stagehand.context.pages()[0];
        if (page) {
          const errorScreenshot = await captureScreenshot(
            page,
            options.screenshotDir,
            `${scenario.name}-error`,
            { type: 'error', url: page.url() }
          );
          screenshots.push(errorScreenshot);
        }
      }
    } catch {
      // Ignore screenshot errors during error handling
    }

    // Try cleanup even on error
    try {
      if (scenario.cleanup?.deleteAllSitesViaAPI) {
        await deleteAllSitesViaAPI(stagehand);
      }
    } catch {
      // Ignore cleanup errors
    }

    try {
      await stagehand.close();
    } catch {
      // Ignore close errors
    }

    return {
      scenario: scenario.name,
      success: false,
      message: '',
      steps: 0,
      duration,
      actions: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      screenshots,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface ScreenshotOptions {
  type: 'initial' | 'final' | 'preview' | 'error';
  url?: string;
  scrollPosition?: string;
  fullPage?: boolean;
}

async function captureScreenshot(
  page: ReturnType<Stagehand['context']['pages']>[0],
  dir: string,
  name: string,
  options: ScreenshotOptions
): Promise<ScreenshotInfo> {
  await mkdir(dir, { recursive: true });
  const timestamp = Date.now();
  const filename = `${name}-${timestamp}.png`;
  const filepath = join(dir, filename);

  const buffer = await page.screenshot({ fullPage: options.fullPage ?? false });
  await writeFile(filepath, buffer);

  console.log(`  Screenshot saved: ${filepath}`);
  return {
    path: filepath,
    type: options.type,
    url: options.url,
    scrollPosition: options.scrollPosition,
    timestamp,
  };
}

async function capturePreviewScreenshots(
  stagehand: Stagehand,
  page: ReturnType<Stagehand['context']['pages']>[0],
  screenshotDir: string,
  scenarioName: string,
  config: {
    enabled?: boolean;
    fullPage?: boolean;
    waitForSelector?: string;
    waitMs?: number;
    scrollPositions?: string[];
    captureAllPages?: boolean;
    maxPages?: number;
  },
  screenshots: ScreenshotInfo[]
): Promise<string | undefined> {
  // Note: stagehand is still passed for context.newPage() but we avoid creating
  // a second agent as it can cause "Invalid prompt: ModelMessage[]" errors
  // after long-running scenarios (90+ steps)
  console.log('\n  Attempting to capture preview screenshots...');

  // Try to find and extract the preview URL from the iframe
  let previewUrl: string | undefined;

  try {
    // Look for preview iframe src
    previewUrl = await page.evaluate(() => {
      // Try various selectors for the preview iframe
      const selectors = [
        'iframe[data-testid="preview-iframe"]',
        'iframe[title*="preview"]',
        'iframe[title*="Preview"]',
        'iframe.preview-frame',
        '#preview-iframe',
        'iframe[src*="preview"]',
        'iframe[src*=".dev"]',
        'iframe[src*="localhost"]',
      ];

      for (const selector of selectors) {
        const iframe = document.querySelector(selector) as HTMLIFrameElement | null;
        if (iframe?.src) {
          return iframe.src;
        }
      }

      // Fallback: look for any iframe with an http(s) src
      const allIframes = document.querySelectorAll('iframe');
      for (const iframe of allIframes) {
        if (iframe.src && (iframe.src.startsWith('http://') || iframe.src.startsWith('https://'))) {
          // Skip known non-preview iframes
          if (!iframe.src.includes('sso.') && !iframe.src.includes('auth.')) {
            return iframe.src;
          }
        }
      }

      return undefined;
    });

    if (!previewUrl) {
      console.log('  No preview iframe URL found, trying additional selectors...');

      // Try more aggressive iframe detection without using AI agent
      // (Creating a second agent after 90+ steps can cause Stagehand state issues)
      previewUrl = await page.evaluate(() => {
        // Look for any iframe with a preview-like URL pattern
        const allIframes = document.querySelectorAll('iframe');
        for (const iframe of allIframes) {
          const src = iframe.src || iframe.getAttribute('data-src') || '';
          if (src && (
            src.includes('preview') ||
            src.includes('.airoapp.') ||
            src.includes('.dev') ||
            (src.startsWith('http') && !src.includes('sso.') && !src.includes('auth.') && !src.includes('godaddy.com'))
          )) {
            return src;
          }
        }
        return undefined;
      });
    }

    if (!previewUrl) {
      console.log('  Could not find preview URL');
      return undefined;
    }

    console.log(`  Found preview URL: ${previewUrl}`);

    // Open preview in a new tab
    const previewPage = await stagehand.context.newPage();
    await previewPage.goto(previewUrl, { waitUntil: 'networkidle' });

    // Wait for page to stabilize
    const waitMs = config.waitMs ?? 2000;
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // Wait for specific selector if provided
    if (config.waitForSelector) {
      try {
        await previewPage.waitForSelector(config.waitForSelector, { timeout: 10000 });
      } catch {
        console.log(`  Warning: waitForSelector "${config.waitForSelector}" timed out`);
      }
    }

    // Take screenshots at different scroll positions for the homepage
    const positions = config.scrollPositions ?? ['top'];

    for (const position of positions) {
      await scrollToPosition(previewPage, position);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll

      const screenshot = await captureScreenshot(
        previewPage,
        screenshotDir,
        `${scenarioName}-preview-home-${position}`,
        {
          type: 'preview',
          url: previewUrl,
          scrollPosition: position,
          fullPage: position === 'top' ? (config.fullPage ?? true) : false,
        }
      );
      screenshots.push(screenshot);
    }

    // Capture all pages if enabled
    if (config.captureAllPages === true) {
      await captureAllSitePages(
        previewPage,
        previewUrl,
        screenshotDir,
        scenarioName,
        {
          fullPage: config.fullPage ?? true,
          waitMs: config.waitMs ?? 2000,
          maxPages: config.maxPages ?? 10,
        },
        screenshots
      );
    }

    // Close preview tab
    await previewPage.close();

    return previewUrl;
  } catch (error) {
    console.error('  Error capturing preview screenshots:', error);
    return previewUrl;
  }
}

async function scrollToPosition(
  page: ReturnType<Stagehand['context']['pages']>[0],
  position: string
): Promise<void> {
  await page.evaluate((pos) => {
    const height = document.documentElement.scrollHeight - window.innerHeight;
    switch (pos) {
      case 'top':
        window.scrollTo(0, 0);
        break;
      case 'middle':
        window.scrollTo(0, height / 2);
        break;
      case 'bottom':
        window.scrollTo(0, height);
        break;
      default:
        window.scrollTo(0, 0);
    }
  }, position);
}

/**
 * Capture screenshots of all pages in the created website.
 * Finds navigation links and visits each unique page.
 */
async function captureAllSitePages(
  page: ReturnType<Stagehand['context']['pages']>[0],
  baseUrl: string,
  screenshotDir: string,
  scenarioName: string,
  config: { fullPage: boolean; waitMs: number; maxPages: number },
  screenshots: ScreenshotInfo[]
): Promise<void> {
  console.log('\n  Capturing all site pages...');

  const maxPages = config.maxPages;
  const visitedUrls = new Set<string>();
  const baseOrigin = new URL(baseUrl).origin;

  // Add the homepage as already visited
  visitedUrls.add(baseUrl);
  visitedUrls.add(baseUrl.replace(/\/$/, '')); // Without trailing slash

  try {
    // Find all internal navigation links
    const links = await page.evaluate((origin: string) => {
      const anchors = document.querySelectorAll('a[href]');
      const internalLinks: string[] = [];

      for (const anchor of anchors) {
        const href = (anchor as HTMLAnchorElement).href;
        if (!href) continue;

        try {
          const url = new URL(href);
          // Only include links from the same origin
          if (url.origin === origin) {
            // Skip anchor links, javascript:, mailto:, etc.
            if (!href.includes('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
              internalLinks.push(href);
            }
          }
        } catch {
          // Skip invalid URLs
        }
      }

      // Return unique links
      return [...new Set(internalLinks)];
    }, baseOrigin);

    console.log(`  Found ${links.length} internal links`);

    // Visit each unique page and take screenshots
    let pageCount = 0;

    for (const link of links) {
      // Normalize URL for comparison
      const normalizedLink = link.replace(/\/$/, '');

      if (visitedUrls.has(link) || visitedUrls.has(normalizedLink)) {
        continue;
      }

      if (pageCount >= maxPages) {
        console.log(`  Reached max pages limit (${maxPages})`);
        break;
      }

      try {
        console.log(`  Navigating to: ${link}`);
        await page.goto(link, { waitUntil: 'networkidle' });
        visitedUrls.add(link);
        visitedUrls.add(normalizedLink);

        // Wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, config.waitMs));

        // Extract page name from URL for the filename
        const urlPath = new URL(link).pathname;
        const pageName = urlPath === '/' ? 'home' : urlPath.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'page';

        // Take full page screenshot
        const screenshot = await captureScreenshot(
          page,
          screenshotDir,
          `${scenarioName}-page-${pageName}`,
          {
            type: 'preview',
            url: link,
            fullPage: config.fullPage,
          }
        );
        screenshots.push(screenshot);
        pageCount++;

        console.log(`  Captured: ${pageName} (${pageCount}/${maxPages})`);

      } catch (error) {
        console.log(`  Failed to capture ${link}: ${error}`);
      }
    }

    // Return to homepage
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    console.log(`  Captured ${pageCount} additional pages`);

  } catch (error) {
    console.error('  Error capturing site pages:', error);
  }
}

export async function runAllScenarios(
  scenarios: Scenario[],
  options: RunnerOptions = {}
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const scenario of scenarios) {
    const result = await runScenario(scenario, options);
    results.push(result);

    // If a scenario that others depend on fails, skip dependent scenarios
    if (!result.success) {
      const dependentScenarios = scenarios.filter(s => s.dependsOn === scenario.name);
      for (const dependent of dependentScenarios) {
        console.log(`\nSkipping scenario "${dependent.name}" because dependency "${scenario.name}" failed`);
        results.push({
          scenario: dependent.name,
          success: false,
          message: `Skipped: dependency "${scenario.name}" failed`,
          steps: 0,
          duration: 0,
          actions: [],
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
          screenshots: [],
          error: `Dependency failed: ${scenario.name}`,
        });
      }
    }
  }

  return results;
}
