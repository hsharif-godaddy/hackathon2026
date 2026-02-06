#!/usr/bin/env node

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateReport, formatReportSummary, saveReport } from './evaluator.js';
import { runScenario, runAllScenarios } from './runner.js';
import { loadScenario, loadAllScenarios } from './scenarios/loader.js';
import { maybeIndexResults } from './utils/elasticsearch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from package root
config({ path: resolve(__dirname, '../.env') });

// Enable debug logging for Stagehand
// Enable debug logging only if explicitly set
// process.env.DEBUG = process.env.DEBUG || 'stagehand:*';

const DEFAULT_SCENARIOS_DIR = resolve(__dirname, '../scenarios');
const DEFAULT_REPORTS_DIR = resolve(__dirname, '../reports');

interface CLIOptions {
  all: boolean;
  headed: boolean;
  model: string;
  verbose: boolean;
  output: string;
  scenarios: string;
}

function parseArgs(): { options: CLIOptions; scenarioPath?: string } {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    all: false,
    headed: false,
    model: 'anthropic/claude-sonnet-4-5-20250929',
    verbose: false,
    output: DEFAULT_REPORTS_DIR,
    scenarios: DEFAULT_SCENARIOS_DIR,
  };
  let scenarioPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--all' || arg === '-a') {
      options.all = true;
    } else if (arg === '--headed' || arg === '-h') {
      options.headed = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--model' || arg === '-m') {
      const value = args[++i];
      if (value) {
        options.model = value;
      }
    } else if (arg === '--output' || arg === '-o') {
      const value = args[++i];
      if (value) {
        options.output = resolve(value);
      }
    } else if (arg === '--scenarios' || arg === '-s') {
      const value = args[++i];
      if (value) {
        options.scenarios = resolve(value);
      }
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      scenarioPath = resolve(arg);
    }
  }

  return { options, scenarioPath };
}

function printHelp(): void {
  console.log(`
Agentic QA - AI-powered QA testing for Airo Builder

Usage:
  pnpm --filter agentic-qa test [options] [scenario-file]

Options:
  --all, -a           Run all scenarios in the scenarios directory
  --headed, -h        Run with visible browser (not headless)
  --model, -m <name>  AI model to use (default: anthropic/claude-sonnet-4-5-20250929)
  --verbose, -v       Enable verbose logging
  --output, -o <dir>  Output directory for reports (default: ./reports)
  --scenarios, -s <dir> Scenarios directory (default: ./scenarios)
  --help              Show this help message

Examples:
  # Run a specific scenario
  pnpm --filter agentic-qa test scenarios/create-site.yaml

  # Run all scenarios
  pnpm --filter agentic-qa test --all

  # Run with visible browser
  pnpm --filter agentic-qa test --headed scenarios/create-site.yaml

  # Use a different AI model
  pnpm --filter agentic-qa test --model openai/gpt-4o scenarios/create-site.yaml

Environment Variables:
  TEST_USERNAME       GoDaddy test account username
  TEST_PASSWORD       GoDaddy test account password
  ANTHROPIC_API_KEY   Anthropic API key (for Claude models)
  OPENAI_API_KEY      OpenAI API key (for GPT models)

Elasticsearch (optional - for CI/CD result indexing):
  ES_URL              Elasticsearch URL
  ES_USERNAME         Elasticsearch username (or use ES_API_KEY)
  ES_PASSWORD         Elasticsearch password
  ES_API_KEY          Elasticsearch API key (alternative to user/pass)
`);
}

async function main(): Promise<void> {
  const { options, scenarioPath } = parseArgs();

  // Validate environment
  if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
    console.error('Error: TEST_USERNAME and TEST_PASSWORD environment variables are required');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║               AGENTIC QA - Airo Builder                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  const runnerOptions = {
    headed: options.headed,
    screenshotDir: resolve(options.output, 'screenshots'),
    model: options.model,
    verbose: options.verbose,
  };

  let results;

  if (options.all) {
    console.log(`Loading scenarios from: ${options.scenarios}`);
    const scenarios = await loadAllScenarios(options.scenarios);
    console.log(`Found ${scenarios.length} scenarios`);

    results = await runAllScenarios(scenarios, runnerOptions);
  } else if (scenarioPath) {
    console.log(`Loading scenario: ${scenarioPath}`);
    const scenario = await loadScenario(scenarioPath);

    results = [await runScenario(scenario, runnerOptions)];
  } else {
    console.log('No scenario specified. Use --all to run all scenarios or specify a scenario file.');
    console.log('Run with --help for usage information.');
    process.exit(1);
  }

  // Generate and display report
  const report = generateReport(results);
  console.log(formatReportSummary(report));

  // Save report
  await saveReport(report, options.output, 'both');

  // Index to Elasticsearch (if configured)
  await maybeIndexResults(results);

  // Exit with appropriate code
  const exitCode = report.failed > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
