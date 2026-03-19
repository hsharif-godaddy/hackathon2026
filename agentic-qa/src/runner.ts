import { Stagehand } from '@browserbasehq/stagehand';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluate as evaluateQuality } from './quality/index.js';
import type { PlaywrightPage } from './quality/playwright-types.js';
import type { QualityEvaluation } from './quality/types.js';
import type { AgentAction, EvalResult, PreviewScreenshot, Scenario, ScreenshotInfo } from './scenarios/types.js';
import { fetchAppUsage } from './utils/app-usage.js';
import { deleteAllSitesViaAPI, deleteOldestSitesIfOverLimit } from './utils/auth.js';
import { runDeterministicSetup } from './utils/deterministic-actions.js';

export interface RunnerOptions {
  headed?: boolean;
  screenshotDir?: string;
  model?: string;
  verbose?: boolean;
  // Quality evaluation options
  qualityEnabled?: boolean;
  anthropicApiKey?: string;
  anthropicModel?: string;
}

export async function runScenario(
  scenario: Scenario,
  options: RunnerOptions = {}
): Promise<EvalResult> {
  const startTime = Date.now();
  const screenshots: ScreenshotInfo[] = [];
  let previewUrl: string | undefined;
  let quality: QualityEvaluation | undefined;
  let qualityStatus: 'success' | 'failed' | 'skipped' = 'skipped';
  let qualityErrorMsg: string | undefined;

  const defaultModel = process.env.OPENAI_MODEL || 'gpt-5';
  const modelName = options.model || defaultModel;
  const normalizedModelName = modelName.includes('/') ? modelName : `openai/${modelName}`;

  console.log(`Using model: ${normalizedModelName}`);
  console.log(`Base URL: ${process.env.OPENAI_BASE_URL || 'default OpenAI'}`);

  // CaaS proxy is OpenAI-compatible for all models (including Claude),
  // so always use the openai provider with OPENAI_BASE_URL
  const modelConfig = process.env.OPENAI_BASE_URL
    ? {
        modelName: normalizedModelName,
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: process.env.OPENAI_BASE_URL,
      }
    : normalizedModelName;

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
        console.error('Deterministic setup failed: %s', setupResult.error);
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

    const agent = stagehand.agent({
      model: modelConfig,
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

    // Accumulate all actions across rounds (initial + budget chat messages)
    const allActions: AgentAction[] = toAgentActions(result.actions);
    let overallSuccess = result.success;
    let overallMessage = result.message || '';
    let appCostUSD: number | undefined;
    let chatMessagesCompleted = 0;

    // Budget mode: send chat messages one-by-one, checking app cost between each
    const isBudgetMode = scenario.tokenBudgetUSD && scenario.chatMessages?.length;
    if (isBudgetMode) {
      // Fetch the starting spend so budget is additive (startSpend + $5, not absolute $5)
      const initialUsage = await fetchAppUsage(page);
      if (!initialUsage) {
        console.warn('WARNING: Unable to fetch initial usage — skipping budget mode to avoid inaccurate spend tracking.');
        console.warn('Chat messages will NOT be sent. Fix the token-budget API connection and retry.');
      }
      const startSpend = initialUsage?.spend ?? 0;
      const spendTarget = startSpend + scenario.tokenBudgetUSD!;
      appCostUSD = startSpend;

      console.log('\n========== BUDGET MODE ==========');
      if (!initialUsage) console.log('⚠ Initial usage fetch FAILED — budget mode disabled');
      console.log(`Current spend:  $${startSpend.toFixed(4)}`);
      console.log(`Budget to add:  $${scenario.tokenBudgetUSD}`);
      console.log(`Stop target:    $${spendTarget.toFixed(4)}`);
      console.log(`Chat messages:  ${scenario.chatMessages!.length} queued`);
      console.log('=================================\n');

      for (let i = 0; initialUsage && i < scenario.chatMessages!.length; i++) {
        // Check if we've spent enough
        const spent = appCostUSD - startSpend;
        if (spent >= scenario.tokenBudgetUSD!) {
          console.log(`\nBudget reached: spent $${spent.toFixed(4)} (current $${appCostUSD.toFixed(4)} - start $${startSpend.toFixed(4)}) >= $${scenario.tokenBudgetUSD}`);
          console.log(`Completed ${chatMessagesCompleted}/${scenario.chatMessages!.length} chat messages`);
          break;
        }

        const chatMsg = scenario.chatMessages![i];
        console.log(`\n--- Chat message ${i + 1}/${scenario.chatMessages!.length} ---`);
        console.log(`Spend: $${appCostUSD.toFixed(4)} (started at $${startSpend.toFixed(4)}, +$${spent.toFixed(4)} / $${scenario.tokenBudgetUSD})`);
        console.log(`Message: ${chatMsg.substring(0, 80)}${chatMsg.length > 80 ? '...' : ''}`);

        const chatInstruction = [
          `Send this chat message to modify the site: "${chatMsg}"`,
          'Type the message in the chat input, submit it, and wait for the site to update.',
          'Verify the change appeared in the preview before reporting completion.',
        ].join('\n');

        try {
          const chatAgent = stagehand.agent({
            model: modelConfig,
            systemPrompt: scenario.systemPrompt || 'You are a QA tester. Send the chat message and verify the result.',
          });

          const chatResult = await chatAgent.execute({
            instruction: chatInstruction,
            maxSteps: scenario.stepsPerMessage,
          });

          allActions.push(...toAgentActions(chatResult.actions));

          console.log(`Chat message ${i + 1}: ${chatResult.success ? 'OK' : 'FAILED'} (${chatResult.actions?.length || 0} steps)`);

          if (chatResult.success) {
            chatMessagesCompleted++;
          } else {
            console.log(`Chat message failed: ${chatResult.message}`);
          }

        } catch (chatError) {
          console.error('Chat message %d failed: %s', i + 1, chatError);
        }

        // Poll usage with exponential backoff until spend updates or max attempts
        const previousSpend = appCostUSD;
        let usage: Awaited<ReturnType<typeof fetchAppUsage>> = null;
        for (const delay of [3000, 4000, 6000]) {
          await new Promise(resolve => setTimeout(resolve, delay));
          usage = await fetchAppUsage(page);
          if (usage && usage.spend !== previousSpend) break;
        }

        if (!usage) {
          console.warn(
            `Unable to fetch updated usage after chat message ${i + 1}; ` +
            'stopping further messages to avoid exceeding the token budget.'
          );
          break;
        }

        appCostUSD = usage.spend;
        console.log(`Spend after message ${i + 1}: $${appCostUSD.toFixed(4)} (+$${(appCostUSD - startSpend).toFixed(4)})`);

        // Post-message budget check to avoid sending one extra message
        if ((appCostUSD - startSpend) >= scenario.tokenBudgetUSD!) {
          console.log(`\nBudget reached after message ${i + 1}: $${(appCostUSD - startSpend).toFixed(4)} >= $${scenario.tokenBudgetUSD}`);
          break;
        }
      }

      const totalSpent = (appCostUSD ?? startSpend) - startSpend;
      // Store incremental spend (not total account spend) so reports make sense
      appCostUSD = totalSpent;

      // Budget mode succeeds only if earlier steps succeeded AND
      // at least one chat message was completed
      overallSuccess = overallSuccess && chatMessagesCompleted > 0;

      console.log('\n========== BUDGET MODE COMPLETE ==========');
      console.log(`Messages completed: ${chatMessagesCompleted}/${scenario.chatMessages!.length}`);
      console.log(`Start spend:    $${startSpend.toFixed(4)}`);
      console.log(`Final spend:    $${(startSpend + totalSpent).toFixed(4)}`);
      console.log(`Amount spent:   $${totalSpent.toFixed(4)} / $${scenario.tokenBudgetUSD} budget`);
      overallMessage = `Budget mode: ${chatMessagesCompleted}/${scenario.chatMessages!.length} messages, $${totalSpent.toFixed(4)} spent (start $${startSpend.toFixed(4)} -> $${(startSpend + totalSpent).toFixed(4)})`;
      console.log('==========================================\n');
    }

    // Log step count from result
    console.log(`  Completed ${allActions.length} total steps`);

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

    // Run quality evaluation if enabled and we have a preview URL
    const qualityConfig = scenario.qualityEval;
    const shouldRunQuality = options.qualityEnabled !== false &&
      qualityConfig?.enabled !== false &&
      previewUrl;

    if (shouldRunQuality && previewUrl) {
      const qualityUrl = previewUrl; // Type narrowing helper
      console.log('\n========== QUALITY EVALUATION ==========');
      console.log(`Evaluating: ${qualityUrl}`);

      try {
        quality = await evaluateQuality({
          url: qualityUrl,
          config: {
            enabled: true,
            siteType: qualityConfig?.siteType,
            skipCategories: qualityConfig?.skipCategories || [],
            originalPrompt: scenario.sitePrompt?.prompt,
            thresholds: qualityConfig?.thresholds || {
              minOverallScore: 70,
              minPerformance: 50,
              minAccessibility: 80,
            },
          },
          page: stagehand.context.pages().find(p => p.url() === qualityUrl) as PlaywrightPage | undefined,
          screenshots: screenshots.map(s => ({ path: s.path, type: s.type })),
          anthropicApiKey: options.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
          anthropicModel: options.anthropicModel || process.env.ANTHROPIC_MODEL,
          headless: !(options.headed ?? scenario.headed),
        });

        qualityStatus = 'success';
        console.log(`Quality Score: ${quality.overall.score}/100 (Grade: ${quality.overall.grade})`);
        if (quality.overall.criticalIssues.length > 0) {
          console.log('Critical Issues:');
          quality.overall.criticalIssues.forEach(issue => console.log(`  - ${issue}`));
        }
        console.log('=========================================\n');
      } catch (qualityError) {
        qualityStatus = 'failed';
        qualityErrorMsg = qualityError instanceof Error ? qualityError.message : String(qualityError);
        console.warn('Quality evaluation failed: %s', qualityErrorMsg);
      }
    } else {
      qualityStatus = 'skipped';
    }

    // Run cleanup if specified
    if (scenario.cleanup?.deleteAllSitesViaAPI) {
      await deleteAllSitesViaAPI(stagehand);
    }

    const duration = Date.now() - startTime;

    // Get metrics
    const metrics = await stagehand.metrics;

    console.log(`Scenario completed: ${overallSuccess ? 'PASSED' : 'FAILED'}`);
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`  Steps: ${allActions.length}`);
    if (appCostUSD !== undefined) {
      console.log(`  App cost: $${appCostUSD.toFixed(4)}`);
    }

    await stagehand.close();

    return {
      scenario: scenario.name,
      success: overallSuccess,
      message: overallMessage,
      steps: allActions.length,
      duration,
      actions: allActions,
      usage: {
        inputTokens: metrics?.totalPromptTokens || 0,
        outputTokens: metrics?.totalCompletionTokens || 0,
        reasoningTokens: metrics?.totalReasoningTokens || 0,
      },
      screenshots,
      previewUrl,
      quality,
      qualityStatus,
      qualityError: qualityErrorMsg,
      appCostUSD,
      chatMessagesCompleted: isBudgetMode ? chatMessagesCompleted : undefined,
      tokenBudgetUSD: scenario.tokenBudgetUSD,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error('Scenario failed with error: %s', error);

    // No screenshots captured on error — only final/preview screenshots are stored

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

function toAgentActions(actions: unknown[] | undefined): AgentAction[] {
  if (!actions) return [];
  return actions.map((a: unknown) => {
    const action = a as Record<string, unknown>;
    return {
      type: String(action.type || ''),
      reasoning: action.reasoning as string | undefined,
      taskCompleted: Boolean(action.taskCompleted),
      action: action.action as string | undefined,
      pageUrl: action.pageUrl as string | undefined,
      timestamp: Number(action.timestamp || Date.now()),
    };
  });
}

interface ScreenshotOptions {
  type: 'final' | 'preview';
  url?: string;
  scrollPosition?: string;
  fullPage?: boolean;
  waitMs?: number;
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

  // Single stabilization point: let animations, lazy images, fonts settle
  await new Promise(resolve => setTimeout(resolve, options.waitMs ?? 5000));
  const buffer = await page.screenshot({ fullPage: options.fullPage ?? false });
  await writeFile(filepath, buffer);

  console.log(`  Screenshot saved: ${filepath}`);
  return {
    path: filepath,
    type: options.type,
    url: options.url,
    scrollPosition: options.scrollPosition,
    timestamp,
    base64: Buffer.from(buffer).toString('base64'),
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
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for scroll + render

      const screenshot = await captureScreenshot(
        previewPage,
        screenshotDir,
        `${scenarioName}-preview-home-${position}`,
        {
          type: 'preview',
          url: previewUrl,
          scrollPosition: position,
          fullPage: position === 'top' ? (config.fullPage ?? true) : false,
          waitMs: config.waitMs,
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
          waitMs: config.waitMs,
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
  config: { fullPage: boolean; waitMs?: number; maxPages: number },
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

        // Extract page name from URL for the filename
        const urlPath = new URL(link).pathname;
        const pageName = urlPath === '/' ? 'home' : urlPath.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'page';

        // Take full page screenshot (captureScreenshot handles stabilization wait)
        const screenshot = await captureScreenshot(
          page,
          screenshotDir,
          `${scenarioName}-page-${pageName}`,
          {
            type: 'preview',
            url: link,
            fullPage: config.fullPage,
            waitMs: config.waitMs,
          }
        );
        screenshots.push(screenshot);
        pageCount++;

        console.log(`  Captured: ${pageName} (${pageCount}/${maxPages})`);

      } catch (error) {
        console.log('  Failed to capture %s: %s', link, error);
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
