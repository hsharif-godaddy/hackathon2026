import { Stagehand } from '@browserbasehq/stagehand';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { evaluate as evaluateQuality } from './quality/index.js';
import type { PlaywrightPage } from './quality/playwright-types.js';
import type { QualityEvaluation } from './quality/types.js';
import type { AgentAction, EvalResult, FrictionReport, PreviewScreenshot, Scenario, ScreenshotInfo } from './scenarios/types.js';
import { fetchAppUsage } from './utils/app-usage.js';
import { deleteAllSitesViaAPI, deleteOldestSitesIfOverLimit } from './utils/auth.js';
import { runDeterministicSetup, sendDeterministicChatMessage } from './utils/deterministic-actions.js';
import { detectFriction } from './utils/friction-detector.js';
import { extractAppId, fetchBuildMetrics, loadCredentials } from './utils/langfuse.js';

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

function buildFailureHaystack(
  buildResult: Awaited<ReturnType<typeof fetchBuildMetrics>> | null
): string {
  const parts: string[] = [];
  if (buildResult) {
    parts.push(...buildResult.metrics.toolFailedNames);
    parts.push(...buildResult.metrics.toolErrors);
    for (const observation of buildResult.orderedObservations) {
      if (observation.level === 'ERROR') {
        if (observation.name) {
          parts.push(observation.name);
        }
        if (observation.statusMessage) {
          parts.push(observation.statusMessage);
        }
      }
    }
  }

  return parts.join('\n').toLowerCase();
}

export function matchExpectedFailures(
  expectedFailures: string[] | undefined,
  matchMode: 'any' | 'all',
  haystack: string
): { matched: string[]; missing: string[]; satisfied: boolean } {
  const expected = (expectedFailures ?? []).map(signature => signature.trim()).filter(Boolean);
  if (expected.length === 0) {
    return { matched: [], missing: [], satisfied: true };
  }

  const matched = expected.filter(signature => haystack.includes(signature.toLowerCase()));
  const missing = expected.filter(signature => !haystack.includes(signature.toLowerCase()));
  const satisfied = matchMode === 'all' ? missing.length === 0 : matched.length > 0;

  return { matched, missing, satisfied };
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function matchExpectedErrorObservations(
  expected: Array<{ name: string; statusMessage?: string }> | undefined,
  matchMode: 'any' | 'all',
  observations: Array<{ name?: string; statusMessage?: string }>
): {
  matched: Array<{ name: string; statusMessage?: string }>;
  missing: Array<{ name: string; statusMessage?: string }>;
  satisfied: boolean;
} {
  const targets = (expected ?? [])
    .map(function trim(item) {
      return {
        name: item.name.trim(),
        statusMessage: item.statusMessage?.trim(),
      };
    })
    .filter(function keep(item) {
      return item.name.length > 0;
    });

  if (targets.length === 0) {
    return { matched: [], missing: [], satisfied: true };
  }

  const matched = targets.filter(function hasMatch(target) {
    const targetName = normalize(target.name);
    const targetStatus = normalize(target.statusMessage);
    return observations.some(function compare(obs) {
      const nameMatch = normalize(obs.name).includes(targetName);
      if (!nameMatch) {
        return false;
      }
      if (!targetStatus) {
        return true;
      }
      return normalize(obs.statusMessage).includes(targetStatus);
    });
  });

  const missing = targets.filter(function isMissing(target) {
    return !matched.includes(target);
  });

  const satisfied = matchMode === 'all' ? missing.length === 0 : matched.length > 0;
  return { matched, missing, satisfied };
}

export function matchRequiredTools(
  requiredTools: Array<{ name: string }> | undefined,
  matchMode: 'any' | 'all',
  spanNames: string[]
): {
  matched: string[];
  missing: string[];
  satisfied: boolean;
} {
  const required = (requiredTools ?? [])
    .map(function trim(item) {
      return item.name.trim();
    })
    .filter(Boolean);

  if (required.length === 0) {
    return { matched: [], missing: [], satisfied: true };
  }

  const normalized = spanNames.map(function lower(name) {
    return normalize(name);
  });
  const matched = required.filter(function hasMatch(requiredName) {
    const needle = normalize(requiredName);
    return normalized.some(function includes(spanName) {
      return spanName.includes(needle);
    });
  });
  const missing = required.filter(function isMissing(requiredName) {
    return !matched.includes(requiredName);
  });
  const satisfied = matchMode === 'all' ? missing.length === 0 : matched.length > 0;
  return { matched, missing, satisfied };
}

/**
 * Pure-logic evaluation of expected friction patterns against detected friction.
 * Called by runScenario() and exported for unit testing.
 */
export function evaluateFrictionPatterns(
  expectedPatterns: string[],
  matchMode: 'any' | 'all',
  friction: FrictionReport | null | undefined
): { success: boolean; retryable: boolean; error?: string } {
  if (!friction) {
    return {
      success: false,
      retryable: true,
      error: 'Expected friction patterns require Langfuse metrics, but friction detection did not run.',
    };
  }

  const detectedTypes = friction.patterns.map(p => p.type);
  const matched = expectedPatterns.filter(ep => detectedTypes.includes(ep as FrictionReport['patterns'][number]['type']));
  const missing = expectedPatterns.filter(ep => !detectedTypes.includes(ep as FrictionReport['patterns'][number]['type']));
  const satisfied = matchMode === 'all' ? missing.length === 0 : matched.length > 0;

  if (!satisfied) {
    return {
      success: false,
      retryable: true,
      error: `Expected friction patterns not detected (${matchMode}): ${missing.join(' | ')}`,
    };
  }
  return { success: true, retryable: false };
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
      await deleteOldestSitesIfOverLimit(stagehand);
    }

    const agent = stagehand.agent({
      model: modelConfig,
      systemPrompt: scenario.systemPrompt || [
        'You are a QA tester for Airo Builder.',
        'Your goal is to complete the test scenario by interacting with the web application.',
        'Be patient with loading times - site creation can take up to 5 minutes.',
        'If you encounter a sign-in form, use the provided credentials.',
        'Always verify the final state matches the expected outcome.',
      ].join('\n'),
    });

    let result: {
      success: boolean;
      message?: string;
      actions?: unknown[];
    };

    if (scenario.directChatMessage) {
      console.log('Sending deterministic chat message...');
      const chat = await sendDeterministicChatMessage(page, scenario.directChatMessage);
      if (chat.success) {
        result = {
          success: true,
          message: 'Deterministic chat message sent',
          actions: [],
        };
      } else {
        console.warn('Deterministic chat send failed, falling back to agent execution: %s', chat.error);
        result = await agent.execute({
          instruction: `Send this exact chat message and wait for completion:\n\n${scenario.directChatMessage}`,
          maxSteps: scenario.maxSteps,
        });
      }
    } else {
      console.log('Starting agent execution...');

      let instruction = scenario.goal;
      if (scenario.credentials && !handleLogin) {
        instruction += `\n\nCredentials for sign-in if needed:
- Username: ${scenario.credentials.username}
- Password: ${scenario.credentials.password}`;
      }

      console.log('\n========== AGENT INSTRUCTION ==========');
      console.log(scenario.credentials && !handleLogin
        ? instruction.replace(scenario.credentials.password, '[REDACTED]')
        : instruction);
      console.log('========================================\n');

      result = await agent.execute({
        instruction,
        maxSteps: scenario.maxSteps,
      });
    }

    // Log the full result for debugging
    console.log('\n========== AGENT RESULT ==========');
    console.log('Success:', result.success);
    console.log('Message:', result.message);
    console.log('Actions:', JSON.stringify(result.actions, null, 2));
    console.log('===================================\n');

    // Accumulate all actions across rounds (initial + credit chat messages)
    const allActions: AgentAction[] = toAgentActions(result.actions);
    let overallSuccess = result.success;
    let overallMessage = result.message || '';
    let creditsUsed: number | undefined;
    let chatMessagesCompleted = 0;
    let errorMessage: string | undefined;
    let retryableFailure = false;
    const chatMessageTimestamps: number[] = [];

    // Credit mode: send chat messages one-by-one, checking credits between each
    const isCreditMode = Boolean(scenario.creditLimit && scenario.chatMessages?.length);
    if (isCreditMode) {
      const initialUsage = await fetchAppUsage(page);
      if (!initialUsage) {
        console.warn('WARNING: Unable to fetch initial usage — aborting credit mode.');
        console.warn('Chat messages will NOT be sent. Fix the credit grants API connection and retry.');

        overallSuccess = false;
        errorMessage = 'Credit mode unavailable: could not fetch initial usage';
        overallMessage = errorMessage;
        creditsUsed = 0;

        // Skip the rest of credit mode — jump to screenshots/quality
      } else {
        const startCredits = initialUsage.creditsSpent;
        let currentCreditsSpent = startCredits;

        console.log('\n========== CREDIT MODE ==========');
        console.log(`Current credits used:  ${startCredits}`);
        console.log(`Credit limit to add:   ${scenario.creditLimit}`);
        console.log(`Stop target:           ${startCredits + scenario.creditLimit!}`);
        console.log(`Chat messages:         ${scenario.chatMessages!.length} queued`);
        console.log('=================================\n');

        for (let i = 0; i < scenario.chatMessages!.length; i++) {
          const spent = currentCreditsSpent - startCredits;
          if (spent >= scenario.creditLimit!) {
            console.log(`\nCredit limit reached: used ${spent} credits (current ${currentCreditsSpent} - start ${startCredits}) >= ${scenario.creditLimit}`);
            console.log(`Completed ${chatMessagesCompleted}/${scenario.chatMessages!.length} chat messages`);
            break;
          }

          const chatMsg = scenario.chatMessages![i];
          console.log(`\n--- Chat message ${i + 1}/${scenario.chatMessages!.length} ---`);
          console.log(`Credits: ${currentCreditsSpent} (started at ${startCredits}, +${spent} / ${scenario.creditLimit})`);
          console.log(`Message: ${chatMsg.substring(0, 80)}${chatMsg.length > 80 ? '...' : ''}`);

          const chatInstruction = [
            `Send this chat message to modify the site: "${chatMsg}"`,
            'Type the message in the chat input and submit it.',
            'Wait for the response to complete (the loading indicator disappears).',
            'Do NOT open the preview in a new tab or navigate away from the develop page.',
            'Stay on the develop page at all times.',
          ].join('\n');

          // Record when the chat message is sent (for friction detection)
          chatMessageTimestamps.push(Date.now());

          try {
            const chatResult = await agent.execute({
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

          // Poll usage until credits update or max attempts (syncSpend=false on retries)
          const previousCredits = currentCreditsSpent;
          let usage: Awaited<ReturnType<typeof fetchAppUsage>> = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise(resolve => setTimeout(resolve, [3000, 4000, 6000][attempt]));
            usage = await fetchAppUsage(page, attempt === 0);
            if (usage && usage.creditsSpent !== previousCredits) break;
          }

          if (!usage) {
            console.warn(
              `Unable to fetch updated usage after chat message ${i + 1}; ` +
              'stopping further messages to avoid exceeding the credit limit.'
            );
            break;
          }

          currentCreditsSpent = usage.creditsSpent;
          console.log(`Credits after message ${i + 1}: ${currentCreditsSpent} (+${currentCreditsSpent - startCredits})`);

          if ((currentCreditsSpent - startCredits) >= scenario.creditLimit!) {
            console.log(`\nCredit limit reached after message ${i + 1}: ${currentCreditsSpent - startCredits} >= ${scenario.creditLimit}`);
            break;
          }
        }

        creditsUsed = currentCreditsSpent - startCredits;

        // Credit mode succeeds only if earlier steps succeeded AND
        // minimum chat messages threshold is met (defaults to 1)
        const minMessages = scenario.minChatMessages ?? 1;
        overallSuccess = overallSuccess && chatMessagesCompleted >= minMessages;
        if (chatMessagesCompleted < minMessages) {
          errorMessage = `Only ${chatMessagesCompleted}/${minMessages} required chat messages completed`;
          overallMessage = errorMessage;
        }

        console.log('\n========== CREDIT MODE COMPLETE ==========');
        console.log(`Messages completed: ${chatMessagesCompleted}/${scenario.chatMessages!.length}`);
        console.log(`Start credits:      ${startCredits}`);
        console.log(`Final credits:      ${currentCreditsSpent}`);
        console.log(`Credits consumed:   ${creditsUsed} / ${scenario.creditLimit} limit`);
        if (chatMessagesCompleted >= minMessages) {
          overallMessage = `Credit mode: ${chatMessagesCompleted}/${scenario.chatMessages!.length} messages, ${creditsUsed} credits used (start ${startCredits} -> ${currentCreditsSpent})`;
        }
        console.log('==========================================\n');
      }
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

    // Capture endTime before Langfuse fetch so polling overhead doesn't inflate duration
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Fetch website-building agent metrics from Langfuse
    // Extract appId from preview URL subdomain (agents service uses this as Langfuse userId)
    const langfuseAppId = previewUrl ? extractAppId(previewUrl) : null;
    if (previewUrl && !langfuseAppId) {
      console.warn(`Could not extract appId from preview URL: ${previewUrl} — Langfuse metrics will be skipped`);
    }
    const langfuseCreds = loadCredentials();
    const buildResult = (langfuseAppId && langfuseCreds)
      ? await fetchBuildMetrics(langfuseCreds, langfuseAppId, startTime, endTime)
      : null;

    // Run friction detection on ordered observations
    let friction: FrictionReport | undefined;
    if (buildResult) {
      friction = detectFriction(buildResult.orderedObservations, {
        chatMessageTimestamps: chatMessageTimestamps.length > 0 ? chatMessageTimestamps : undefined,
      });

      if (friction.patternCount > 0) {
        console.log('\n========== FRICTION DETECTION ==========');
        console.log(`Patterns found: ${friction.patternCount}`);
        console.log(`Friction score: ${friction.score}/100 (${friction.maxSeverity})`);
        console.log(`Wasted cost:    $${friction.totalWastedCostUSD}`);
        console.log(`Retries:        transient=${friction.retryTransient} agent=${friction.retryAgent} userInduced=${friction.retryUserInduced}`);
        for (const p of friction.patterns) {
          console.log(`  [${p.severity.toUpperCase()}] ${p.type}: ${p.description}`);
        }
        console.log('=========================================\n');
      }
    }

    const allSpanNames = buildResult
      ? buildResult.orderedObservations
        .filter(function onlySpans(obs) {
          return obs.type === 'SPAN' && Boolean(obs.name);
        })
        .map(function name(obs) {
          return obs.name as string;
        })
      : [];
    const requiredTools = matchRequiredTools(
      scenario.requiredTools,
      scenario.requiredToolMatchMode ?? 'all',
      allSpanNames
    );

    if ((scenario.requiredTools?.length ?? 0) > 0) {
      console.log('\n=========== REQUIRED TOOL MATCH ===========');
      console.log(`Mode: ${scenario.requiredToolMatchMode ?? 'all'}`);
      console.log(`Expected: ${scenario.requiredTools?.length ?? 0}`);
      console.log(`Matched: ${requiredTools.matched.length}`);
      if (requiredTools.matched.length > 0) {
        console.log(`Matched tools: ${requiredTools.matched.join(' | ')}`);
      }
      if (requiredTools.missing.length > 0) {
        console.log(`Missing tools: ${requiredTools.missing.join(' | ')}`);
      }
      console.log('===========================================\n');

      if (!buildResult) {
        overallSuccess = false;
        retryableFailure = true;
        errorMessage = 'Required tools cannot be validated because Langfuse observations were not available.';
        overallMessage = errorMessage;
      } else if (!requiredTools.satisfied) {
        overallSuccess = false;
        retryableFailure = true;
        errorMessage = `Required tools not observed (${scenario.requiredToolMatchMode ?? 'all'}): ` +
          `${requiredTools.missing.join(' | ')}`;
        overallMessage = errorMessage;
      }
    }

    const errorObservations = buildResult
      ? buildResult.orderedObservations.filter(function onlyErrorSpans(obs) {
        return obs.level === 'ERROR' && obs.type === 'SPAN';
      })
      : [];
    const expectedObservations = matchExpectedErrorObservations(
      scenario.expectedErrorObservations,
      scenario.observationMatchMode ?? 'all',
      errorObservations
    );

    if ((scenario.expectedErrorObservations?.length ?? 0) > 0) {
      console.log('\n====== EXPECTED ERROR OBSERVATION MATCH ======');
      console.log(`Mode: ${scenario.observationMatchMode ?? 'all'}`);
      console.log(`Expected: ${scenario.expectedErrorObservations?.length ?? 0}`);
      console.log(`Matched: ${expectedObservations.matched.length}`);
      if (expectedObservations.matched.length > 0) {
        console.log(
          `Matched observations: ${
            expectedObservations.matched
              .map(function format(obs) {
                return obs.statusMessage ? `${obs.name} -> ${obs.statusMessage}` : obs.name;
              })
              .join(' | ')
          }`
        );
      }
      if (expectedObservations.missing.length > 0) {
        console.log(
          `Missing observations: ${
            expectedObservations.missing
              .map(function format(obs) {
                return obs.statusMessage ? `${obs.name} -> ${obs.statusMessage}` : obs.name;
              })
              .join(' | ')
          }`
        );
      }
      console.log('==============================================\n');

      if (!buildResult) {
        overallSuccess = false;
        retryableFailure = true;
        errorMessage = 'Expected error observations require Langfuse metrics, but no Langfuse observations were found.';
        overallMessage = errorMessage;
      } else if (!expectedObservations.satisfied) {
        overallSuccess = false;
        retryableFailure = true;
        errorMessage = `Expected error observations not observed (${scenario.observationMatchMode ?? 'all'}): ` +
          `${expectedObservations.missing.map(function format(obs) {
            return obs.statusMessage ? `${obs.name} -> ${obs.statusMessage}` : obs.name;
          }).join(' | ')}`;
        overallMessage = errorMessage;
      }
    }

    const failureHaystack = buildFailureHaystack(buildResult);
    const expectedFailures = matchExpectedFailures(
      scenario.expectedFailures,
      scenario.failureMatchMode ?? 'any',
      failureHaystack
    );

    if ((scenario.expectedFailures?.length ?? 0) > 0) {
      console.log('\n========== EXPECTED FAILURE MATCH ==========');
      console.log(`Mode: ${scenario.failureMatchMode ?? 'any'}`);
      console.log(`Expected: ${scenario.expectedFailures?.length ?? 0}`);
      console.log(`Matched: ${expectedFailures.matched.length}`);
      if (expectedFailures.matched.length > 0) {
        console.log(`Matched signatures: ${expectedFailures.matched.join(' | ')}`);
      }
      if (expectedFailures.missing.length > 0) {
        console.log(`Missing signatures: ${expectedFailures.missing.join(' | ')}`);
      }
      console.log('============================================\n');

      if (!buildResult) {
        overallSuccess = false;
        retryableFailure = true;
        errorMessage = 'Expected failure signatures require Langfuse metrics, but no Langfuse observations were found.';
        overallMessage = errorMessage;
      } else if (!expectedFailures.satisfied) {
        overallSuccess = false;
        retryableFailure = true;
        errorMessage = `Expected failure signatures not observed (${scenario.failureMatchMode ?? 'any'}): ` +
          `${expectedFailures.missing.join(' | ')}`;
        overallMessage = errorMessage;
      }
    }

    // Run cleanup if specified
    if (scenario.cleanup?.deleteAllSitesViaAPI) {
      await deleteAllSitesViaAPI(stagehand);
    }

    // Assert expected friction patterns if configured
    if ((scenario.expectedFrictionPatterns?.length ?? 0) > 0) {
      const expectedPatterns = scenario.expectedFrictionPatterns!;
      const matchMode = scenario.frictionPatternMatchMode ?? 'any';

      console.log('\n======= EXPECTED FRICTION PATTERN MATCH =======');
      console.log(`Langfuse available: ${friction != null}`);
      console.log(`Mode: ${matchMode}`);
      console.log(`Expected: ${expectedPatterns.join(' | ')}`);

      const frictionResult = evaluateFrictionPatterns(expectedPatterns, matchMode, friction);

      if (!friction) {
        console.log('Detected: (friction detection did not run — Langfuse unavailable)');
      } else {
        const detectedTypes = friction.patterns.map(p => p.type);
        console.log(`Detected: ${detectedTypes.length > 0 ? detectedTypes.join(' | ') : '(none)'}`);
        const matched = expectedPatterns.filter(ep => detectedTypes.includes(ep as typeof detectedTypes[number]));
        const missing = expectedPatterns.filter(ep => !detectedTypes.includes(ep as typeof detectedTypes[number]));
        console.log(`Matched: ${matched.length > 0 ? matched.join(' | ') : '(none)'}`);
        if (missing.length > 0) {
          console.log(`Missing: ${missing.join(' | ')}`);
        }
      }
      console.log('===============================================\n');

      if (!frictionResult.success) {
        overallSuccess = false;
        retryableFailure = frictionResult.retryable;
        errorMessage = frictionResult.error;
        overallMessage = errorMessage ?? '';
      }
    }

    // Get metrics
    const metrics = await stagehand.metrics;

    console.log(`Scenario completed: ${overallSuccess ? 'PASSED' : 'FAILED'}`);
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`  Steps: ${allActions.length}`);
    if (creditsUsed !== undefined) {
      console.log(`  Credits used: ${creditsUsed}`);
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
      error: errorMessage,
      retryable: retryableFailure,
      quality,
      qualityStatus,
      qualityError: qualityErrorMsg,
      creditsUsed,
      chatMessagesCompleted: isCreditMode ? chatMessagesCompleted : undefined,
      creditLimit: scenario.creditLimit,
      buildMetrics: buildResult?.metrics ?? undefined,
      friction,
      chatMessageTimestamps: chatMessageTimestamps.length > 0 ? chatMessageTimestamps : undefined,
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
    } catch (cleanupErr) {
      console.warn('Cleanup error: %s', cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
    }

    try {
      await stagehand.close();
    } catch (closeErr) {
      console.warn('Browser close error: %s', closeErr instanceof Error ? closeErr.message : String(closeErr));
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
      retryable: false,
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

async function triggerLazyImages(
  page: ReturnType<Stagehand['context']['pages']>[0]
): Promise<void> {
  await page.evaluate(async () => {
    const distance = Math.max(window.innerHeight * 0.8, 600);
    const totalHeight = document.documentElement.scrollHeight;
    for (let y = 0; y < totalHeight; y += distance) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
  });
  await new Promise(resolve => setTimeout(resolve, 10000));
}

async function captureScreenshot(
  page: ReturnType<Stagehand['context']['pages']>[0],
  dir: string,
  name: string,
  options: ScreenshotOptions
): Promise<ScreenshotInfo> {
  await mkdir(dir, { recursive: true });
  const timestamp = Date.now();
  const safeName = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const filename = `${safeName}-${timestamp}.png`;
  const filepath = join(dir, filename);

  if (options.fullPage) {
    await triggerLazyImages(page);
  }

  await new Promise(resolve => setTimeout(resolve, options.waitMs ?? 3000));
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
