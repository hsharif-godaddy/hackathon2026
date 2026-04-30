#!/usr/bin/env node
/**
 * Runs targeted scenario in sequence.
 * Quality eval is off for speed. Exit code: 1 if scenario failed, 0 if passed.
 *
 * Env: TEST_USERNAME, TEST_PASSWORD, and OPENAI_API_KEY or ANTHROPIC_API_KEY.
 *
 * Usage (from agentic-qa package):
 *   pnpm test:repro
 *   pnpm exec tsx src/run-repro-scenarios.ts --headless
 */
import { config } from 'dotenv';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatReportSummary, generateReport, saveReport } from './evaluator.js';
import type { EvalResult, Scenario } from './scenarios/types.js';
import { runScenario } from './runner.js';
import { loadScenario } from './scenarios/loader.js';
import { extractAppId } from './utils/langfuse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');

config({ path: resolve(pkgRoot, '.env') });

const REPRO_SCENARIOS = [
  'scenarios/prod-critical-failures/colorscheme-no-description.yaml',
] as const;

// Outer wall-clock guard. YAML-level `timeout` (e.g. 420 s) fires first as the
// inner soft limit; this outer guard is a safety net for when the inner timer or
// runner hangs. Keep it strictly greater than the YAML timeout.
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 12 * 60 * 1000;
const SCENARIO_TIMEOUT_MS: Partial<Record<typeof REPRO_SCENARIOS[number], number>> = {
  // No override needed — the default 720 s outer guard exceeds the YAML 420 s inner timeout.
};

const SCENARIO_MAX_ATTEMPTS: Partial<Record<typeof REPRO_SCENARIOS[number], number>> = {
  'scenarios/prod-critical-failures/colorscheme-no-description.yaml': 1,
};
function timeoutResult(scenario: Scenario, timeoutMs: number): EvalResult {
  return {
    scenario: scenario.name,
    success: false,
    message: `Hard timeout after ${Math.round(timeoutMs / 1000)}s (fail-fast guard in repro runner)`,
    steps: 0,
    duration: timeoutMs,
    actions: [],
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    screenshots: [],
    error: `Timed out after ${timeoutMs}ms`,
  };
}

async function runWithTimeout(
  scenario: Scenario,
  relPath: typeof REPRO_SCENARIOS[number],
  options: Parameters<typeof runScenario>[1]
): Promise<EvalResult> {
  const timeoutMs = SCENARIO_TIMEOUT_MS[relPath] ?? DEFAULT_WALL_CLOCK_TIMEOUT_MS;
  const started = Date.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<EvalResult>(function onTimer(resolveTimer) {
    timeoutHandle = setTimeout(function timedOut() {
      resolveTimer(timeoutResult(scenario, timeoutMs));
    }, timeoutMs);
  });

  let result: EvalResult;
  try {
    result = await Promise.race([runScenario(scenario, options), timer]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
  const appId = result.previewUrl ? extractAppId(result.previewUrl) : null;
  const toolFailures = result.buildMetrics?.toolErrorCount ?? -1;
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  const failureCount = toolFailures >= 0 ? String(toolFailures) : 'n/a';

  console.log(
    `Run result: ${scenario.name} | success=${result.success} | appId=${appId ?? 'n/a'} | ` +
      `failures=${failureCount} | elapsed=${elapsedSec}s`
  );

  return result;
}

function retryable(result: EvalResult): boolean {
  if (!result.error) {
    return false;
  }
  const error = result.error.toLowerCase();
  // Hard timeouts should not burn retry slots — fail fast
  if (error.includes('timed out after')) {
    return false;
  }
  if (error.includes('login timed out') || error.includes('deterministic setup failed')) {
    return false;
  }
  return (
    error.includes('required tools not observed') ||
    error.includes('expected error observations not observed') ||
    error.includes('expected failure signatures not observed')
  );
}

async function runWithRetries(
  scenario: Scenario,
  relPath: typeof REPRO_SCENARIOS[number],
  options: Parameters<typeof runScenario>[1]
): Promise<EvalResult> {
  const maxAttempts = SCENARIO_MAX_ATTEMPTS[relPath] ?? 1;
  let latest: EvalResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (maxAttempts > 1) {
      console.log(`Attempt ${attempt}/${maxAttempts}: ${scenario.name}`);
    }
    latest = await runWithTimeout(scenario, relPath, options);
    if (latest.success) {
      return latest;
    }
    if (attempt < maxAttempts && retryable(latest)) {
      console.log(`Retrying ${scenario.name} due to unmatched target signature...`);
      continue;
    }
    break;
  }

  return latest ?? timeoutResult(scenario, DEFAULT_WALL_CLOCK_TIMEOUT_MS);
}

async function main(): Promise<void> {
  if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
    console.error('Missing TEST_USERNAME / TEST_PASSWORD');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY or OPENAI_API_KEY');
    process.exit(1);
  }

  const headed = !process.argv.includes('--headless');
  const screenshotDir = resolve(pkgRoot, 'reports', 'repro-screenshots');
  await mkdir(screenshotDir, { recursive: true });

  const runnerOptions = {
    headed,
    screenshotDir,
    qualityEnabled: false,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
    model: process.env.OPENAI_MODEL || 'gpt-5',
  };

  console.log('');
  console.log(`═══ Airo repro batch — ${REPRO_SCENARIOS.length} scenarios (browser headed=${headed}) ═══`);
  console.log('');

  const results = [];
  for (let i = 0; i < REPRO_SCENARIOS.length; i++) {
    const rel = REPRO_SCENARIOS[i];
    const path = resolve(pkgRoot, rel);
    console.log(`\n>>> [${i + 1}/${REPRO_SCENARIOS.length}] Loading ${rel}\n`);

    let scenario: Scenario;
    try {
      scenario = await loadScenario(path);
    } catch (loadError) {
      const errorMsg = loadError instanceof Error ? loadError.message : String(loadError);
      console.error(`Failed to load scenario ${rel}: ${errorMsg}`);
      results.push({
        scenario: rel,
        success: false,
        message: `Scenario load failed: ${errorMsg}`,
        steps: 0,
        duration: 0,
        actions: [],
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        screenshots: [],
        error: errorMsg,
      } satisfies EvalResult);
      continue;
    }
    results.push(await runWithRetries(scenario, rel, runnerOptions));
  }

  const report = generateReport(results);
  console.log(formatReportSummary(report));

  const outDir = resolve(pkgRoot, 'reports');
  await saveReport(report, outDir, 'both');

  const exitCode = report.failed > 0 ? 1 : 0;
  console.log(
    `\nExit ${exitCode} (${report.failed} scenario(s) failed, ${report.passed} passed). ` +
      'Under known friction, failed runs are useful for Langfuse debugging.\n'
  );
  process.exit(exitCode);
}

main().catch(function onFatal(err: unknown) {
  console.error(err);
  process.exit(1);
});
