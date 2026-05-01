#!/usr/bin/env node
/**
 * Runs targeted repro scenarios in sequence with per-scenario retry + timeout.
 *
 * This is intentionally separate from index.ts:
 * - index.ts is the general-purpose CLI runner (supports --all, quality eval, ES indexing).
 * - This file provides retry/timeout wrappers specifically for friction-eval repro runs.
 * - The CI workflow (.github/workflows/agentic-qa.yml) invokes this via `pnpm test:repro`.
 * - REPRO_SCENARIOS list mirrors the CI matrix; both must be updated together.
 *
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
  'scenarios/friction-evals/user-correction-friction.yaml',
  'scenarios/friction-evals/request-timeout-abort-repro.yaml',
  'scenarios/prod-critical-failures/terminal-dangerous-pattern.yaml',
  'scenarios/prod-critical-failures/colorscheme-no-description.yaml',
  'scenarios/prod-critical-failures/publish-failure.yaml',
  'scenarios/prod-critical-failures/str-replace-no-match.yaml',
] as const;

// Outer wall-clock guard. YAML-level `timeout` (e.g. 420 s) fires first as the
// inner soft limit; this outer guard is a safety net for when the inner timer or
// runner hangs. Keep it strictly greater than the YAML timeout.
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 12 * 60 * 1000;
const SCENARIO_TIMEOUT_MS: Partial<Record<typeof REPRO_SCENARIOS[number], number>> = {
  // user-correction YAML timeout is 900 s (15 min), so outer guard must exceed it.
  'scenarios/friction-evals/user-correction-friction.yaml': 18 * 60 * 1000,
  // request-timeout YAML timeout is 900 s; outer guard is deliberately lower (10 min)
  // to keep CI cost bounded — the scenario should trigger abort/timeout patterns well
  // before 15 min. This is not a misconfiguration.
  'scenarios/friction-evals/request-timeout-abort-repro.yaml': 10 * 60 * 1000,
  // publish-failure YAML timeout is 600 s (10 min); outer guard slightly exceeds it
  // so the scenario's own timeout fires first and Promise.race is deterministic.
  'scenarios/prod-critical-failures/publish-failure.yaml': 11 * 60 * 1000,
};

// Max retry attempts per scenario. Scenarios with expectedFailures, requiredTools,
// expectedErrorObservations, or expectedFrictionPatterns benefit from attempts > 1
// because retryable() returns true for their assertion-failure error strings.
const SCENARIO_MAX_ATTEMPTS: Partial<Record<typeof REPRO_SCENARIOS[number], number>> = {
  'scenarios/friction-evals/user-correction-friction.yaml': 2,
  'scenarios/friction-evals/request-timeout-abort-repro.yaml': 2,
  'scenarios/prod-critical-failures/terminal-dangerous-pattern.yaml': 2,
  'scenarios/prod-critical-failures/colorscheme-no-description.yaml': 2,
  'scenarios/prod-critical-failures/publish-failure.yaml': 2,
  'scenarios/prod-critical-failures/str-replace-no-match.yaml': 2,
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
    retryable: false,
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

  // Attach catch so a background rejection (after timeout wins) doesn't crash the process.
  const scenarioPromise = runScenario(scenario, options);
  scenarioPromise.catch((err: unknown) => {
    console.warn(
      `[${scenario.name}] Background rejection after timeout: ${err instanceof Error ? err.message : String(err)}`
    );
  });

  let result: EvalResult;
  try {
    result = await Promise.race([scenarioPromise, timer]);
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
  // Prefer structured field when available (set by runner.ts assertion blocks).
  // For results from the current runner, retryable is always a boolean — the only
  // case where it's undefined is the outer catch block (runner.ts:772) which produces
  // a minimal EvalResult without touching the field. That's the legacy path.
  if (result.retryable !== undefined) {
    return result.retryable;
  }
  // Fallback: infer from error string for backward compatibility with persisted results
  // or the outer catch block. In practice these string matches are unreachable for
  // results produced by the success path (since retryable is always set there), but
  // are kept defensively for future-proofing and backward compat with older results.
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
    error.includes('expected failure signatures not observed') ||
    error.includes('expected friction patterns not detected')
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
      const reason = latest.error ?? 'unknown';
      console.log(`Retrying ${scenario.name} (attempt ${attempt}/${maxAttempts}): ${reason}`);
      continue;
    }
    if (attempt < maxAttempts && !retryable(latest)) {
      console.log(`Not retrying ${scenario.name}: ${latest.error ?? 'no error field'}`);
    }
    if (attempt === maxAttempts) {
      console.log(
        `Final attempt for ${scenario.name}: success=false, retryable=${retryable(latest)}, error=${latest.error ?? 'none'}`
      );
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
