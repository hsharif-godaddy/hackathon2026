#!/usr/bin/env node

import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateReport, formatReportSummary, saveReport } from './evaluator.js';
import { evaluateStandalone } from './quality/index.js';
import type { EvaluationCategory, SiteType } from './quality/types.js';
import { runAllScenarios, runScenario } from './runner.js';
import { loadAllScenarios, loadScenario } from './scenarios/loader.js';
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
  // Quality evaluation options
  quality: boolean;
  qualityOnly: boolean;
  qualityUrl?: string;
  siteType?: SiteType;
  skipQuality?: EvaluationCategory[];
  // Credit limit override
  credits?: number;
}

function parseArgs(): { options: CLIOptions; scenarioPath?: string } {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    all: false,
    headed: false,
    model: 'gpt-5',
    verbose: false,
    output: DEFAULT_REPORTS_DIR,
    scenarios: DEFAULT_SCENARIOS_DIR,
    quality: true, // Quality evaluation enabled by default
    qualityOnly: false,
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
    } else if (arg === '--quality' || arg === '-q') {
      options.quality = true;
    } else if (arg === '--no-quality') {
      options.quality = false;
    } else if (arg === '--quality-only') {
      options.qualityOnly = true;
      options.quality = true;
    } else if (arg === '--url' || arg === '-u') {
      const value = args[++i];
      if (value) {
        try {
          new URL(value);
        } catch {
          console.error('Invalid URL: %s — must be a fully qualified URL (e.g. https://example.com)', value);
          process.exit(1);
        }
        options.qualityUrl = value;
      }
    } else if (arg === '--site-type') {
      const value = args[++i];
      if (value) {
        options.siteType = value as SiteType;
      }
    } else if (arg === '--skip-quality') {
      const value = args[++i];
      if (value) {
        options.skipQuality = value.split(',').map(s => s.trim()) as EvaluationCategory[];
      }
    } else if (arg === '--credits' || arg === '-c') {
      const value = args[++i];
      if (value === undefined) {
        console.error('Missing value for --credits/-c — expected a positive number');
        process.exit(1);
      }
      const parsed = parseFloat(value);
      if (isNaN(parsed) || parsed <= 0) {
        console.error('Invalid credit limit: %s — must be a positive number', value);
        process.exit(1);
      }
      options.credits = parsed;
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
  --all, -a             Run all scenarios in the scenarios directory
  --headed, -h          Run with visible browser (not headless)
  --model, -m <name>    AI model to use (default: gpt-5)
                        Use bare name (gpt-5) or provider-qualified (openai/gpt-5)
  --verbose, -v         Enable verbose logging
  --output, -o <dir>    Output directory for reports (default: ./reports)
  --scenarios, -s <dir> Scenarios directory (default: ./scenarios)
  --help                Show this help message

Credit Options:
  --credits, -c <num>   Override creditLimit for the scenario (e.g. --credits 500)

Quality Evaluation Options:
  --quality, -q         Enable quality evaluation (default: on)
  --no-quality          Disable quality evaluation
  --quality-only        Run quality evaluation only (skip scenario execution)
  --url, -u <url>       URL to evaluate (for standalone quality evaluation)
  --site-type <type>    Site type for business-fit evaluation
                        (landing-page, ecommerce, portfolio, restaurant, blog, etc.)
  --skip-quality <cats> Skip quality categories (comma-separated)
                        (performance, accessibility, seo, functional, visual,
                         content, security, usability, businessFit)

Examples:
  # Run a specific scenario with quality evaluation
  pnpm --filter agentic-qa test scenarios/create-site.yaml

  # Run a credit-based build (build until 500 credits used)
  pnpm --filter agentic-qa test scenarios/credit-constraint-runs/credit-build.yaml

  # Override credit limit from CLI
  pnpm --filter agentic-qa test --credits 1000 scenarios/credit-constraint-runs/credit-build.yaml

  # Run all scenarios
  pnpm --filter agentic-qa test --all

  # Evaluate an existing website (standalone mode)
  pnpm --filter agentic-qa test --quality-only --url https://example.com

  # Evaluate with specific site type
  pnpm --filter agentic-qa test --quality-only --url https://shop.example.com --site-type ecommerce

  # Skip AI-based evaluators for faster results
  pnpm --filter agentic-qa test --skip-quality visual,content,usability,businessFit

  # Run with visible browser
  pnpm --filter agentic-qa test --headed scenarios/create-site.yaml

  # Use a different AI model
  pnpm --filter agentic-qa test --model openai/gpt-4o scenarios/create-site.yaml

Environment Variables:
  TEST_USERNAME       GoDaddy test account username
  TEST_PASSWORD       GoDaddy test account password
  ANTHROPIC_API_KEY   Anthropic API key (for Claude models and quality evaluation)
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

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║               AGENTIC QA - Airo Builder                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Standalone quality evaluation mode
  if (options.qualityOnly && options.qualityUrl) {
    console.log('Running standalone quality evaluation...');
    console.log(`URL: ${options.qualityUrl}`);
    console.log(`Site Type: ${options.siteType || 'generic'}`);
    console.log('');

    const result = await evaluateStandalone({
      url: options.qualityUrl,
      siteType: options.siteType,
      skipCategories: options.skipQuality || [],
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      anthropicModel: process.env.ANTHROPIC_MODEL,
      outputDir: options.output,
      format: 'both',
      headless: !options.headed,
    });

    // Display results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                    QUALITY EVALUATION RESULTS                  ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log(`Overall Score: ${result.evaluation.overall.score}/100`);
    console.log(`Grade: ${result.evaluation.overall.grade}`);
    console.log(`Meets Thresholds: ${result.meetsThresholds ? 'Yes' : 'No'}`);
    console.log('');

    console.log('Category Scores:');
    if (result.evaluation.performance) console.log(`  Performance:   ${result.evaluation.performance.score}/100`);
    if (result.evaluation.accessibility) console.log(`  Accessibility: ${result.evaluation.accessibility.score}/100`);
    if (result.evaluation.seo) console.log(`  SEO:           ${result.evaluation.seo.score}/100`);
    if (result.evaluation.functional) console.log(`  Functional:    ${result.evaluation.functional.score}/100`);
    if (result.evaluation.visual) console.log(`  Visual:        ${result.evaluation.visual.score}/100`);
    if (result.evaluation.content) console.log(`  Content:       ${result.evaluation.content.score}/100`);
    if (result.evaluation.security) console.log(`  Security:      ${result.evaluation.security.score}/100`);
    if (result.evaluation.usability) console.log(`  Usability:     ${result.evaluation.usability.score}/100`);
    if (result.evaluation.businessFit) console.log(`  Business Fit:  ${result.evaluation.businessFit.score}/100`);
    console.log('');

    if (result.evaluation.overall.criticalIssues.length > 0) {
      console.log('Critical Issues:');
      result.evaluation.overall.criticalIssues.forEach(issue => console.log(`  - ${issue}`));
      console.log('');
    }

    if (result.evaluation.overall.recommendations.length > 0) {
      console.log('Recommendations:');
      result.evaluation.overall.recommendations.slice(0, 5).forEach(rec => console.log(`  - ${rec}`));
      console.log('');
    }

    console.log(`Duration: ${(result.evaluation.metadata.duration / 1000).toFixed(1)}s`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Save the quality report
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(options.output, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(options.output, `quality-report-${timestamp}.json`);
    await writeFile(jsonPath, JSON.stringify(result, null, 2));
    console.log(`Quality report saved: ${jsonPath}`);

    process.exit(result.meetsThresholds ? 0 : 1);
  }

  // Validate environment for scenario execution
  if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
    console.error('Error: TEST_USERNAME and TEST_PASSWORD environment variables are required');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  const runnerOptions = {
    headed: options.headed,
    screenshotDir: resolve(options.output, 'screenshots'),
    model: options.model,
    verbose: options.verbose,
    qualityEnabled: options.quality,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL,
  };

  let results;

  if (options.all) {
    console.log(`Loading scenarios from: ${options.scenarios}`);
    const scenarios = await loadAllScenarios(options.scenarios);

    // Apply credit limit override from CLI
    if (options.credits) {
      for (const s of scenarios) {
        s.creditLimit = options.credits;
      }
      console.log(`Credit limit override: ${options.credits} credits applied to all scenarios`);
    }

    console.log(`Found ${scenarios.length} scenarios`);
    results = await runAllScenarios(scenarios, runnerOptions);
  } else if (scenarioPath) {
    console.log(`Loading scenario: ${scenarioPath}`);
    const scenario = await loadScenario(scenarioPath);

    // Apply credit limit override from CLI
    if (options.credits) {
      scenario.creditLimit = options.credits;
      console.log(`Credit limit override: ${options.credits} credits`);
    }

    results = [await runScenario(scenario, runnerOptions)];
  } else if (options.qualityOnly) {
    console.log('Error: --quality-only requires --url <url> to specify the website to evaluate.');
    console.log('Run with --help for usage information.');
    process.exit(1);
  } else {
    console.log('No scenario specified. Use --all to run all scenarios or specify a scenario file.');
    console.log('For standalone quality evaluation, use: --quality-only --url <url>');
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
